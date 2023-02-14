// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.6.11;

import "../LQTY/CommunityIssuance.sol";

contract CommunityIssuanceTester is CommunityIssuance {
    function unprotectedIssueLQTY() external returns (uint issuance) {
        if (lastIssuanceTimestamp < lastDistributionTime) {
            uint256 endTimestamp = block.timestamp > lastDistributionTime ? lastDistributionTime : block.timestamp;
            uint256 timePassed = endTimestamp.sub(lastIssuanceTimestamp);
            issuance = timePassed.mul(rewardPerSecond);
            totalOATHIssued = totalOATHIssued.add(issuance);
        }

        lastIssuanceTimestamp = block.timestamp;
    }
}
