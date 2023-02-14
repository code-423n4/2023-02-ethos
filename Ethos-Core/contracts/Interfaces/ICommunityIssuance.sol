// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.6.11;

interface ICommunityIssuance { 
    
    // --- Events ---
    
    event OATHTokenAddressSet(address _lqtyTokenAddress);
    event StabilityPoolAddressSet(address _stabilityPoolAddress);
    event TotalOathIssuedUpdated(uint _totalLQTYIssued);

    // --- Functions ---

    function setAddresses(address _lqtyTokenAddress, address _stabilityPoolAddress) external;

    function issueOath() external returns (uint);

    function sendOath(address _account, uint _LQTYamount) external;
}
