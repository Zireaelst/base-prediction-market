// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Compile with Solidity 0.8.24+, deploy only on chain 84532. Deploy
/// TestToken first, then this contract with its address, a verified Base Sepolia
/// Chainlink AggregatorV3 price-feed proxy, maxPriceAge and resolutionWindow.
/// Neither deployment nor feed/token address is supplied by this source. Check
/// feed availability, decimals, heartbeat and proxy history before using it.
interface IERC20Test {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IAggregatorV3 {
    function decimals() external view returns (uint8);
    function latestRoundData() external view returns (
        uint80, int256, uint256, uint256, uint80
    );
}

/// @notice Unrestricted faucet token: valueless testnet use only.
contract TestToken {
    string public constant name = "Prediction Test Token";
    string public constant symbol = "PTT";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor() { require(block.chainid == 84532, "Base Sepolia only"); }
    function mint(uint256 amount) external {
        totalSupply += amount;
        balanceOf[msg.sender] += amount;
        emit Transfer(address(0), msg.sender, amount);
    }
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }
    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
            emit Approval(from, msg.sender, allowed - amount);
        }
        _transfer(from, to, amount);
        return true;
    }
    function _transfer(address from, address to, uint256 amount) private {
        require(to != address(0), "zero recipient");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}

/// @notice Equal-stake two-party predictions. No owner, fees or custody powers.
/// A market compares the first successful post-deadline checkpoint with target
/// in feed decimals, not the price at the deadline. Anyone may resolve during
/// the resolution window using the latest completed Chainlink round updated at
/// or after the deadline and no older than maxPriceAge. Caller timing can affect
/// the outcome. If no checkpoint succeeds in time, anyone can void the market
/// and each party can withdraw their own stake. Unmatched markets may be voided
/// immediately after the deadline. Withdrawals are always pull-based.
contract BaseSepoliaPrediction {
    enum Status { None, Open, Matched, CreatorWon, OpponentWon, Void }
    struct Market {
        address creator;
        address opponent;
        uint256 stake;
        uint256 target;
        uint64 deadline;
        bool creatorAbove;
        Status status;
        uint256 price;
    }
    struct Authorization {
        uint256 maxPerTrade;
        uint256 remaining;
        uint64 expiresAt;
        uint256 epoch;
    }
    // kind 0 creates, kind 1 joins. For joins marketId/stake must match the
    // market, and target/deadline/creatorAbove must all be zero/false.
    struct Swipe {
        address owner;
        address delegate;
        uint8 kind;
        uint256 marketId;
        uint256 target;
        uint64 deadline;
        uint256 stake;
        bool creatorAbove;
        uint256 nonce;
        uint64 validUntil;
        uint256 epoch;
    }

    IERC20Test public immutable token;
    IAggregatorV3 public immutable feed;
    uint8 public immutable feedDecimals;
    uint64 public immutable maxPriceAge;
    uint64 public immutable resolutionWindow;
    uint256 public marketCount;
    mapping(uint256 => Market) public markets;
    mapping(address => mapping(address => Authorization)) public authorizations;
    mapping(address => mapping(uint256 => bool)) public usedNonces;
    mapping(address => uint256) public credits;
    uint256 private locked = 1;

    bytes32 public constant SWIPE_TYPEHASH = keccak256("Swipe(address owner,address delegate,uint8 kind,uint256 marketId,uint256 target,uint64 deadline,uint256 stake,bool creatorAbove,uint256 nonce,uint64 validUntil,uint256 epoch)");
    bytes32 private constant DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    uint256 private constant HALF_ORDER = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;
    event MarketCreated(uint256 indexed id, address indexed creator, uint256 stake, uint256 target, uint64 deadline, bool creatorAbove);
    event MarketJoined(uint256 indexed id, address indexed opponent);
    event MarketResolved(uint256 indexed id, Status status, uint256 price, uint80 roundId, uint256 updatedAt);
    event MarketVoided(uint256 indexed id);
    event AuthorizationSet(address indexed owner, address indexed delegate, uint256 maxPerTrade, uint256 remaining, uint64 expiresAt, uint256 epoch);
    event NonceCancelled(address indexed owner, uint256 nonce);
    event Withdrawn(address indexed owner, uint256 amount);

    modifier nonReentrant() { require(locked == 1, "reentrancy"); locked = 2; _; locked = 1; }
    constructor(address token_, address feed_, uint64 maxPriceAge_, uint64 resolutionWindow_) {
        require(block.chainid == 84532, "Base Sepolia only");
        require(token_.code.length != 0 && feed_.code.length != 0, "invalid contracts");
        require(maxPriceAge_ != 0 && resolutionWindow_ != 0, "invalid timing");
        token = IERC20Test(token_);
        feed = IAggregatorV3(feed_);
        feedDecimals = IAggregatorV3(feed_).decimals();
        maxPriceAge = maxPriceAge_;
        resolutionWindow = resolutionWindow_;
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256("BaseSepoliaPrediction"), keccak256("1"), block.chainid, address(this)));
    }
    function swipeDigest(Swipe calldata s) public view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(SWIPE_TYPEHASH, s.owner, s.delegate, s.kind, s.marketId, s.target, s.deadline, s.stake, s.creatorAbove, s.nonce, s.validUntil, s.epoch));
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }
    /// @notice Replacing or revoking an authorization invalidates all its old signatures.
    function authorize(address delegate, uint256 maxPerTrade, uint256 total, uint64 expiresAt) external {
        require(delegate != address(0) && delegate != msg.sender, "invalid delegate");
        require(maxPerTrade != 0 && total >= maxPerTrade && expiresAt > block.timestamp, "invalid limits");
        Authorization storage a = authorizations[msg.sender][delegate];
        a.epoch++;
        a.maxPerTrade = maxPerTrade;
        a.remaining = total;
        a.expiresAt = expiresAt;
        emit AuthorizationSet(msg.sender, delegate, maxPerTrade, total, expiresAt, a.epoch);
    }
    function revoke(address delegate) external {
        Authorization storage a = authorizations[msg.sender][delegate];
        a.epoch++;
        a.maxPerTrade = 0;
        a.remaining = 0;
        a.expiresAt = 0;
        emit AuthorizationSet(msg.sender, delegate, 0, 0, 0, a.epoch);
    }
    function cancelNonce(uint256 nonce) external {
        usedNonces[msg.sender][nonce] = true;
        emit NonceCancelled(msg.sender, nonce);
    }
    function create(uint256 target, uint64 deadline, uint256 stake, bool creatorAbove) external nonReentrant returns (uint256) {
        return _create(msg.sender, target, deadline, stake, creatorAbove);
    }
    function join(uint256 id) external nonReentrant { _join(msg.sender, id); }

    /// @notice Anyone may relay a delegate's EIP-712 signature; owner must first
    /// grant both token allowance and delegate authorization. Nonces are global
    /// per owner and consumed atomically. Only EOA delegate signatures supported.
    function executeSwipe(Swipe calldata s, uint8 v, bytes32 r, bytes32 sigS) external nonReentrant returns (uint256 id) {
        Authorization storage a = authorizations[s.owner][s.delegate];
        require(s.owner != address(0) && s.delegate != address(0), "zero signer");
        require(s.epoch == a.epoch && block.timestamp < a.expiresAt && block.timestamp <= s.validUntil, "authorization expired");
        require(s.stake != 0 && s.stake <= a.maxPerTrade && s.stake <= a.remaining, "limit exceeded");
        require(!usedNonces[s.owner][s.nonce], "nonce used");
        require((v == 27 || v == 28) && uint256(sigS) != 0 && uint256(sigS) <= HALF_ORDER, "invalid signature");
        require(ecrecover(swipeDigest(s), v, r, sigS) == s.delegate, "wrong signer");
        usedNonces[s.owner][s.nonce] = true;
        a.remaining -= s.stake;
        if (s.kind == 0) {
            require(s.marketId == 0, "invalid create");
            id = _create(s.owner, s.target, s.deadline, s.stake, s.creatorAbove);
        } else {
            require(s.kind == 1 && s.target == 0 && s.deadline == 0 && !s.creatorAbove, "invalid join");
            require(markets[s.marketId].stake == s.stake, "stake mismatch");
            id = s.marketId;
            _join(s.owner, id);
        }
    }
    function _deposit(address from, uint256 amount) private {
        uint256 beforeBalance = token.balanceOf(address(this));
        require(token.transferFrom(from, address(this), amount), "transfer failed");
        require(token.balanceOf(address(this)) == beforeBalance + amount, "unsupported token");
    }
    function _create(address owner, uint256 target, uint64 deadline, uint256 stake, bool creatorAbove) private returns (uint256 id) {
        require(target != 0 && stake != 0 && stake <= type(uint256).max / 2 && deadline > block.timestamp, "invalid market");
        _deposit(owner, stake);
        id = ++marketCount;
        markets[id] = Market(owner, address(0), stake, target, deadline, creatorAbove, Status.Open, 0);
        emit MarketCreated(id, owner, stake, target, deadline, creatorAbove);
    }
    function _join(address owner, uint256 id) private {
        Market storage m = markets[id];
        require(m.status == Status.Open && block.timestamp < m.deadline && owner != m.creator, "cannot join");
        _deposit(owner, m.stake);
        m.opponent = owner;
        m.status = Status.Matched;
        emit MarketJoined(id, owner);
    }
    /// @notice Checkpoint the latest qualifying post-deadline oracle round.
    function resolve(uint256 id) external nonReentrant {
        Market storage m = markets[id];
        require(m.status == Status.Matched && block.timestamp >= m.deadline &&
            block.timestamp < uint256(m.deadline) + resolutionWindow, "not resolvable");
        (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt,) = feed.latestRoundData();
        require(roundId != 0 && answer > 0, "invalid answer");
        require(startedAt != 0 && startedAt <= updatedAt && updatedAt >= m.deadline &&
            updatedAt <= block.timestamp && block.timestamp - updatedAt <= maxPriceAge, "invalid timestamps");
        uint256 price = uint256(answer);
        bool yes = price >= m.target;
        m.price = price;
        bool creatorWon = yes == m.creatorAbove;
        m.status = creatorWon ? Status.CreatorWon : Status.OpponentWon;
        credits[creatorWon ? m.creator : m.opponent] += m.stake * 2;
        emit MarketResolved(id, m.status, price, roundId, updatedAt);
    }
    function voidMarket(uint256 id) external nonReentrant {
        Market storage m = markets[id];
        require((m.status == Status.Open && block.timestamp >= m.deadline) ||
            (m.status == Status.Matched && block.timestamp >= uint256(m.deadline) + resolutionWindow), "cannot void");
        bool matched = m.status == Status.Matched;
        m.status = Status.Void;
        credits[m.creator] += m.stake;
        if (matched) credits[m.opponent] += m.stake;
        emit MarketVoided(id);
    }
    function withdraw() external nonReentrant {
        uint256 amount = credits[msg.sender];
        require(amount != 0, "nothing owed");
        credits[msg.sender] = 0;
        require(token.transfer(msg.sender, amount), "transfer failed");
        emit Withdrawn(msg.sender, amount);
    }
}
