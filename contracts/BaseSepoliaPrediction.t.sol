// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./BaseSepoliaPrediction.sol";

interface Vm {
    function chainId(uint256) external;
    function warp(uint256) external;
    function prank(address) external;
    function expectRevert() external;
    function addr(uint256) external returns (address);
    function sign(uint256, bytes32) external returns (uint8, bytes32, bytes32);
}

contract HistoricalFeed {
    struct Round { int256 answer; uint256 updatedAt; uint80 answeredInRound; }
    mapping(uint80 => Round) public rounds;
    uint80 public latest;
    function decimals() external pure returns (uint8) { return 8; }
    function set(uint80 id, int256 answer, uint256 updatedAt, uint80 answeredInRound) external {
        rounds[id] = Round(answer, updatedAt, answeredInRound);
        latest = id;
    }
    function getRoundData(uint80 id) external view returns (uint80, int256, uint256, uint256, uint80) {
        Round memory r = rounds[id];
        require(r.updatedAt != 0, "missing");
        return (id, r.answer, r.updatedAt, r.updatedAt, r.answeredInRound);
    }
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        Round memory r = rounds[latest];
        return (latest, r.answer, r.updatedAt, r.updatedAt, r.answeredInRound);
    }
}

contract BaseSepoliaPredictionTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    TestToken private token;
    HistoricalFeed private feed;
    BaseSepoliaPrediction private market;
    address private alice = address(0xA11CE);
    address private bob = address(0xB0B);

    function setUp() public {
        vm.chainId(84532);
        vm.warp(1000);
        token = new TestToken();
        feed = new HistoricalFeed();
        market = new BaseSepoliaPrediction(address(token), address(feed), 20, 60);
        vm.prank(alice); token.mint(1000);
        vm.prank(bob); token.mint(1000);
        vm.prank(alice); token.approve(address(market), 1000);
        vm.prank(bob); token.approve(address(market), 1000);
    }
    function open() private returns (uint256 id) {
        vm.prank(alice); id = market.create(200, 1100, 100, true);
        vm.prank(bob); market.join(id);
    }
    function testCheckpointResolutionAndWithdraw() public {
        uint256 id = open();
        feed.set(43, 200, 1102, 43);
        vm.warp(1102);
        market.resolve(id);
        require(market.credits(alice) == 200, "wrong winner");
        vm.prank(alice); market.withdraw();
        require(token.balanceOf(alice) == 1100, "wrong payout");
        vm.expectRevert(); market.resolve(id);
    }
    function testStaleRoundRefundsBoth() public {
        uint256 id = open();
        feed.set(42, 200, 1099, 42);
        vm.warp(1101);
        vm.expectRevert(); market.resolve(id);
        vm.warp(1160); market.voidMarket(id);
        require(market.credits(alice) == 100 && market.credits(bob) == 100, "wrong refunds");
    }
    function testStalePostDeadlineRoundFailsClosed() public {
        uint256 id = open();
        feed.set(42, 200, 1100, 42);
        vm.warp(1121);
        vm.expectRevert(); market.resolve(id);
    }
    function testCheckpointWindowIsStrict() public {
        uint256 id = open();
        feed.set(42, 200, 1160, 42);
        vm.warp(1160);
        vm.expectRevert(); market.resolve(id);
        market.voidMarket(id);
        require(market.credits(alice) == 100 && market.credits(bob) == 100, "wrong refunds");
    }
    function testDeprecatedAnsweredInRoundDoesNotBlockValidPrice() public {
        uint256 id = open();
        feed.set(42, 200, 1100, 0);
        vm.warp(1100);
        market.resolve(id);
        require(market.credits(alice) == 200, "valid round rejected");
    }
    function testUnmatchedRefund() public {
        vm.prank(alice); uint256 id = market.create(200, 1100, 100, true);
        vm.warp(1100); market.voidMarket(id);
        require(market.credits(alice) == 100, "wrong refund");
    }
    function testDelegationLimitsReplayAndRevocation() public {
        uint256 key = 123;
        address delegate = vm.addr(key);
        vm.prank(alice); market.authorize(delegate, 100, 200, 1200);
        BaseSepoliaPrediction.Swipe memory s = BaseSepoliaPrediction.Swipe(alice, delegate, 0, 0, 200, 1100, 100, true, 1, 1150, 1);
        (uint8 v, bytes32 r, bytes32 sigS) = vm.sign(key, market.swipeDigest(s));
        market.executeSwipe(s, v, r, sigS);
        vm.expectRevert(); market.executeSwipe(s, v, r, sigS);
        s.nonce = 2;
        (v, r, sigS) = vm.sign(key, market.swipeDigest(s));
        vm.prank(alice); market.revoke(delegate);
        vm.expectRevert(); market.executeSwipe(s, v, r, sigS);
    }
    function testInvalidAnswerFailsClosed() public {
        uint256 id = open();
        feed.set(42, 0, 1100, 42);
        vm.warp(1100);
        vm.expectRevert(); market.resolve(id);
    }
    function testDelegatedStakeAndExpiryLimits() public {
        uint256 key = 123;
        address delegate = vm.addr(key);
        vm.prank(alice); market.authorize(delegate, 100, 100, 1200);
        BaseSepoliaPrediction.Swipe memory s = BaseSepoliaPrediction.Swipe(alice, delegate, 0, 0, 200, 1300, 101, true, 1, 1250, 1);
        (uint8 v, bytes32 r, bytes32 sigS) = vm.sign(key, market.swipeDigest(s));
        vm.expectRevert(); market.executeSwipe(s, v, r, sigS);
        s.stake = 100;
        (v, r, sigS) = vm.sign(key, market.swipeDigest(s));
        vm.warp(1200);
        vm.expectRevert(); market.executeSwipe(s, v, r, sigS);
    }
    function testDelegationTotalLimitCannotBeExceededAcrossTrades() public {
        uint256 key = 123;
        address delegate = vm.addr(key);
        vm.prank(alice); market.authorize(delegate, 100, 150, 1200);
        BaseSepoliaPrediction.Swipe memory s = BaseSepoliaPrediction.Swipe(alice, delegate, 0, 0, 200, 1300, 100, true, 1, 1150, 1);
        (uint8 v, bytes32 r, bytes32 sigS) = vm.sign(key, market.swipeDigest(s));
        market.executeSwipe(s, v, r, sigS);
        s.nonce = 2;
        (v, r, sigS) = vm.sign(key, market.swipeDigest(s));
        vm.expectRevert(); market.executeSwipe(s, v, r, sigS);
    }
}
