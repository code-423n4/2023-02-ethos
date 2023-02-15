// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.6.11;
pragma experimental ABIEncoderV2;

import "../Interfaces/ITellorCaller.sol";
import "./ITellor.sol";
import "./SafeMath.sol";
import "./UsingTellor.sol";
/*
* This contract has a single external function that calls Tellor: getTellorCurrentValue(). 
*
* The function is called by the Liquity contract PriceFeed.sol. If any of its inner calls to Tellor revert, 
* this function will revert, and PriceFeed will catch the failure and handle it accordingly.
*
* The function comes from Tellor's own wrapper contract, 'UsingTellor.sol':
* https://github.com/tellor-io/usingtellor/blob/master/contracts/UsingTellor.sol
*
*/
contract TellorCaller is UsingTellor, ITellorCaller {
    using SafeMath for uint256;

    constructor (address payable _tellorMasterAddress) UsingTellor(_tellorMasterAddress) public {}

    /*
    * getTellorCurrentValue(): identical to getCurrentValue() in UsingTellor.sol
    *
    * @dev Allows the user to get the latest value for the queryId specified
    * @param _queryId is the queryId to look up the value for
    * @return ifRetrieve bool true if it is able to retrieve a value, the value, and the value's timestamp
    * @return value the value retrieved
    * @return _timestampRetrieved the value's timestamp
    */
    function getTellorCurrentValue(bytes32 _queryId)
        external
        view
        override
        returns (
            bool ifRetrieve,
            uint256 value,
            uint256 _timestampRetrieved
        )
    {
        (bytes memory data, uint256 timestamp) = getDataBefore(_queryId, block.timestamp - 20 minutes);
        uint256 _value = abi.decode(data, (uint256));
        if (timestamp == 0 || _value == 0) return (false, _value, timestamp);
        return (true, _value, timestamp);
    }
}
