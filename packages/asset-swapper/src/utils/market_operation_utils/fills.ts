import { FillQuoteTransformerOrderType } from '@0x/protocol-utils';
import { BigNumber, hexUtils } from '@0x/utils';

import { MarketOperation, NativeOrderWithFillableAmounts } from '../../types';

import { POSITIVE_INF, SOURCE_FLAGS, ZERO_AMOUNT } from './constants';
import { DexSample, ERC20BridgeSource, FeeSchedule, Fill } from './types';

// tslint:disable: prefer-for-of no-bitwise completed-docs

export function ethToOutputAmount({
    input,
    output,
    ethAmount,
    inputAmountPerEth,
    outputAmountPerEth,
}: {
    input: BigNumber;
    output: BigNumber;
    inputAmountPerEth: BigNumber;
    outputAmountPerEth: BigNumber;
    ethAmount: BigNumber | number;
}): BigNumber {
    return !outputAmountPerEth.isZero()
        ? outputAmountPerEth.times(ethAmount)
        : inputAmountPerEth.times(ethAmount).times(output.dividedToIntegerBy(input));
}

export function nativeOrdersToFills(
    side: MarketOperation,
    orders: NativeOrderWithFillableAmounts[],
    targetInput: BigNumber = POSITIVE_INF,
    outputAmountPerEth: BigNumber,
    inputAmountPerEth: BigNumber,
    fees: FeeSchedule,
    filterNegativeAdjustedRateOrders: boolean = true,
): Fill[] {
    const sourcePathId = hexUtils.random();
    // Create a single path from all orders.
    let fills: Array<Fill & { adjustedRate: BigNumber }> = [];
    for (const o of orders) {
        const { fillableTakerAmount, fillableTakerFeeAmount, fillableMakerAmount, type } = o;
        const makerAmount = fillableMakerAmount;
        const takerAmount = fillableTakerAmount.plus(fillableTakerFeeAmount);
        const input = side === MarketOperation.Sell ? takerAmount : makerAmount;
        const output = side === MarketOperation.Sell ? makerAmount : takerAmount;
        const fee = fees[ERC20BridgeSource.Native] === undefined ? 0 : fees[ERC20BridgeSource.Native]!(o);
        const outputPenalty = ethToOutputAmount({
            input,
            output,
            inputAmountPerEth,
            outputAmountPerEth,
            ethAmount: fee,
        });
        // targetInput can be less than the order size
        // whilst the penalty is constant, it affects the adjusted output
        // only up until the target has been exhausted.
        // A large order and an order at the exact target should be penalized
        // the same.
        const clippedInput = BigNumber.min(targetInput, input);
        // scale the clipped output inline with the input
        const clippedOutput = clippedInput.dividedBy(input).times(output);
        const adjustedOutput =
            side === MarketOperation.Sell ? clippedOutput.minus(outputPenalty) : clippedOutput.plus(outputPenalty);
        const adjustedRate =
            side === MarketOperation.Sell ? adjustedOutput.div(clippedInput) : clippedInput.div(adjustedOutput);
        // Optionally skip orders with rates that are <= 0.
        if (filterNegativeAdjustedRateOrders && adjustedRate.lte(0)) {
            continue;
        }
        fills.push({
            sourcePathId,
            adjustedRate,
            adjustedOutput,
            input: clippedInput,
            output: clippedOutput,
            flags: SOURCE_FLAGS[type === FillQuoteTransformerOrderType.Rfq ? 'RfqOrder' : 'LimitOrder'],
            index: 0, // TBD
            parent: undefined, // TBD
            source: ERC20BridgeSource.Native,
            type,
            fillData: { ...o },
        });
    }
    // Sort by descending adjusted rate.
    fills = fills.sort((a, b) => b.adjustedRate.comparedTo(a.adjustedRate));
    // Re-index fills.
    for (let i = 0; i < fills.length; ++i) {
        fills[i].parent = i === 0 ? undefined : fills[i - 1];
        fills[i].index = i;
    }
    return fills;
}

export function dexSampleToFill(
    side: MarketOperation,
    sample: DexSample,
    outputAmountPerEth: BigNumber,
    inputAmountPerEth: BigNumber,
    fees: FeeSchedule,
): Fill {
    const sourcePathId = hexUtils.random();
    const { source, fillData } = sample;
    const input = sample.input;
    const output = sample.output;
    const fee = fees[source] === undefined ? 0 : fees[source]!(sample.fillData) || 0;
    const penalty = ethToOutputAmount({
        input,
        output,
        inputAmountPerEth,
        outputAmountPerEth,
        ethAmount: fee,
    });
    const adjustedOutput = side === MarketOperation.Sell ? output.minus(penalty) : output.plus(penalty);
    return {
        sourcePathId,
        input,
        output,
        adjustedOutput,
        source,
        fillData,
        type: FillQuoteTransformerOrderType.Bridge,
        index: 0,
        parent: undefined,
        flags: SOURCE_FLAGS[source],
    };
}
