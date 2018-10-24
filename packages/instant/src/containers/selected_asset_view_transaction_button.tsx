import * as _ from 'lodash';
import * as React from 'react';
import { connect } from 'react-redux';

import { State } from '../redux/reducer';

import { ViewTransactionButton } from '../components/view_transaction_button';
import { AsyncProcessState } from '../types';
import { etherscanUtil } from '../util/etherscan';

export interface SelectedAssetViewTransactionButtonProps {}

interface ConnectedState {
    onClick: () => void;
}

const mapStateToProps = (state: State, _ownProps: {}): ConnectedState => ({
    onClick: () => {
        if (state.assetBuyer && state.buyOrderState.processState === AsyncProcessState.SUCCESS) {
            const etherscanUrl = etherscanUtil.getEtherScanTxnAddressIfExists(
                state.buyOrderState.txnHash,
                state.assetBuyer.networkId,
            );
            if (etherscanUrl) {
                window.open(etherscanUrl, '_blank');
                return;
            }
        }
    },
});

export const SelectedAssetViewTransactionButton: React.ComponentClass<
    SelectedAssetViewTransactionButtonProps
> = connect(mapStateToProps)(ViewTransactionButton);
