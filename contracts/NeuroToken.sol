// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title NeuroStore Token ($NEURO)
 * @dev The economic settlement engine for the V7 decentralized storage network.
 * Deployed to Base L2. Allows the central Gateway (acting as a decentralized Oracle)
 * to autonomously stream ERC-20 utility tokens to physical Node Operators
 * based purely on mathematically verified ZK-SNARK PoSt (Proof of Spacetime) calculations.
 */
contract NeuroToken is ERC20, Ownable {
    uint256 public constant SECONDS_PER_EPOCH = 12; // 1 Base L2 Block
    uint256 public constant REWARD_PER_EPOCH_PER_GB = 10 * 10**18; // 10 NEURO per GB/epoch

    // Tracks total mathematical storage verified per physical operator
    mapping(address => uint256) public storageAllocationsGB;
    
    // Tracks the last claimed mathematical epoch timestamp for precision streaming
    mapping(address => uint256) public lastClaimedTimestamp;

    event StorageVerified(address indexed operator, uint256 gigabytes);
    event RewardsStreamed(address indexed operator, uint256 amount);

    /**
     * @notice Initialize the NeuroStore settlement token
     */
    constructor() ERC20("NeuroStore", "NEURO") Ownable(msg.sender) {
        // Mint an initial supply to the Treasury for Decentralized Liquidity Pools (Uniswap V3)
        _mint(msg.sender, 1_000_000_000 * 10**decimals());
    }

    /**
     * @notice Gateway Oracle verifies a ZK-SNARK Merkle Root Proof of Spacetime.
     * Updates the operator's active physical storage allocation in gigabytes.
     * 
     * @param operator The wallet address of the neuro-node.exe Windows runner.
     * @param gigabytesStored The mathematically proven physical payload size.
     */
    function verifyStoragePoSt(address operator, uint256 gigabytesStored) external onlyOwner {
        // If the ZK Proof fails off-chain, the Gateway skips verification
        storageAllocationsGB[operator] = gigabytesStored;
        if (lastClaimedTimestamp[operator] == 0) {
            lastClaimedTimestamp[operator] = block.timestamp;
        }
        emit StorageVerified(operator, gigabytesStored);
    }

    /**
     * @notice Allows an operator to mathematically pull their earned $NEURO tokens on-chain.
     * Overcomes the final Web3 hurdle by removing reliance on centralized Web2 Stripe payouts.
     *
     * @param operator The wallet address of the physical node withdrawing liquidity.
     */
    function streamRewards(address operator) external {
        uint256 lastClaimed = lastClaimedTimestamp[operator];
        require(lastClaimed > 0, "No verified ZK-SNARK PoSt on network record.");
        require(block.timestamp > lastClaimed, "Rewards uniformly streamed for current block.");

        uint256 timeDelta = block.timestamp - lastClaimed;
        uint256 activeGB = storageAllocationsGB[operator];

        // Autonomous Market Maker logic: Issue tokens sequentially based on rigorous PoSt runtime
        // Multiply before divide to ensure 100% precision even for sub-epoch runtimes
        uint256 rewardAmount = (timeDelta * activeGB * REWARD_PER_EPOCH_PER_GB) / SECONDS_PER_EPOCH;

        require(rewardAmount > 0, "Insufficient epoch runtime for streaming block.");

        lastClaimedTimestamp[operator] = block.timestamp;

        // Mathematically mint the strictly earned utility tokens to the provider's wallet
        _mint(operator, rewardAmount);

        emit RewardsStreamed(operator, rewardAmount);
    }
}
