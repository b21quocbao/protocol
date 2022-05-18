import { BigNumber } from '@0x/utils';

import { MarketOperation } from '../../types';

import { POSITIVE_INF, ZERO_AMOUNT } from './constants';
import { ethToOutputAmount } from './fills';
import { createBridgeOrder, createNativeOptimizedOrder, CreateOrderFromPathOpts, getMakerTakerTokens } from './orders';
import { getCompleteRate, getRate } from './rate_utils';
import {
    CollapsedFill,
    ERC20BridgeSource,
    ExchangeProxyOverhead,
    Fill,
    NativeCollapsedFill,
    OptimizedMarketOrder,
} from './types';

// tslint:disable: prefer-for-of no-bitwise completed-docs

export interface PathSize {
    input: BigNumber;
    output: BigNumber;
}

export interface PathPenaltyOpts {
    outputAmountPerEth: BigNumber;
    inputAmountPerEth: BigNumber;
    exchangeProxyOverhead: ExchangeProxyOverhead;
    gasPrice: BigNumber;
}

export const DEFAULT_PATH_PENALTY_OPTS: PathPenaltyOpts = {
    outputAmountPerEth: ZERO_AMOUNT,
    inputAmountPerEth: ZERO_AMOUNT,
    exchangeProxyOverhead: () => ZERO_AMOUNT,
    gasPrice: ZERO_AMOUNT,
};

export class Path {
    public collapsedFills?: ReadonlyArray<CollapsedFill>;
    public orders?: OptimizedMarketOrder[];
    public sourceFlags: bigint = BigInt(0);
    protected _size: PathSize = { input: ZERO_AMOUNT, output: ZERO_AMOUNT };
    protected _adjustedSize: PathSize = { input: ZERO_AMOUNT, output: ZERO_AMOUNT };

    public static create(
        side: MarketOperation,
        fills: ReadonlyArray<Fill>,
        targetInput: BigNumber = POSITIVE_INF,
        pathPenaltyOpts: PathPenaltyOpts = DEFAULT_PATH_PENALTY_OPTS,
    ): Path {
        const path = new Path(side, fills, targetInput, pathPenaltyOpts);
        fills.forEach(fill => {
            path.sourceFlags |= fill.flags;
            path._addFillSize(fill);
        });
        return path;
    }

    protected constructor(
        protected readonly side: MarketOperation,
        public fills: ReadonlyArray<Fill>,
        protected readonly targetInput: BigNumber,
        public readonly pathPenaltyOpts: PathPenaltyOpts,
    ) {}

    /**
     * Collapses this path, creating fillable orders with the information required
     * for settlement
     */
    public collapse(opts: CreateOrderFromPathOpts): CollapsedPath {
        const [makerToken, takerToken] = getMakerTakerTokens(opts);
        const collapsedFills = this.collapsedFills === undefined ? this._collapseFills() : this.collapsedFills;
        this.orders = [];
        for (let i = 0; i < collapsedFills.length; ) {
            if (collapsedFills[i].source === ERC20BridgeSource.Native) {
                this.orders.push(createNativeOptimizedOrder(collapsedFills[i] as NativeCollapsedFill, opts.side));
                ++i;
                continue;
            }

            this.orders.push(createBridgeOrder(collapsedFills[i], makerToken, takerToken, opts.side));
            i += 1;
        }
        return this as CollapsedPath;
    }

    public adjustedSize(): PathSize {
        const { input, output } = this._adjustedSize;
        const { exchangeProxyOverhead, outputAmountPerEth, inputAmountPerEth } = this.pathPenaltyOpts;
        const gasOverhead = exchangeProxyOverhead(this.sourceFlags);
        const pathPenalty = ethToOutputAmount({
            input,
            output,
            inputAmountPerEth,
            outputAmountPerEth,
            ethAmount: gasOverhead,
        });
        return {
            input,
            output: this.side === MarketOperation.Sell ? output.minus(pathPenalty) : output.plus(pathPenalty),
        };
    }

    public adjustedCompleteRate(): BigNumber {
        const { input, output } = this.adjustedSize();
        return getCompleteRate(this.side, input, output, this.targetInput);
    }

    /**
     * Calculates the rate of this path, where the output has been
     * adjusted for penalties (e.g cost)
     */
    public adjustedRate(): BigNumber {
        const { input, output } = this.adjustedSize();
        return getRate(this.side, input, output);
    }

    /**
     * Returns the best possible rate this path can offer, given the fills.
     */
    public bestRate(): BigNumber {
        const best = this.fills.reduce((prevRate, curr) => {
            const currRate = getRate(this.side, curr.input, curr.output);
            return prevRate.isLessThan(currRate) ? currRate : prevRate;
        }, new BigNumber(0));
        return best;
    }

    /**
     * Compares two paths returning if this adjusted path
     * is better than the other adjusted path
     */
    public isAdjustedBetterThan(other: Path): boolean {
        if (!this.targetInput.isEqualTo(other.targetInput)) {
            throw new Error(`Target input mismatch: ${this.targetInput} !== ${other.targetInput}`);
        }
        const { targetInput } = this;
        const { input } = this._size;
        const { input: otherInput } = other._size;
        if (input.isLessThan(targetInput) || otherInput.isLessThan(targetInput)) {
            return input.isGreaterThan(otherInput);
        } else {
            return this.adjustedCompleteRate().isGreaterThan(other.adjustedCompleteRate());
        }
    }

    private _collapseFills(): ReadonlyArray<CollapsedFill> {
        this.collapsedFills = [];
        for (const fill of this.fills) {
            const source = fill.source;
            if (this.collapsedFills.length !== 0 && source !== ERC20BridgeSource.Native) {
                const prevFill = this.collapsedFills[this.collapsedFills.length - 1];
                // If the last fill is from the same source, merge them.
                if (prevFill.sourcePathId === fill.sourcePathId) {
                    prevFill.input = prevFill.input.plus(fill.input);
                    prevFill.output = prevFill.output.plus(fill.output);
                    prevFill.fillData = fill.fillData;
                    prevFill.subFills.push(fill);
                    continue;
                }
            }
            (this.collapsedFills as CollapsedFill[]).push({
                sourcePathId: fill.sourcePathId,
                source: fill.source,
                type: fill.type,
                fillData: fill.fillData,
                input: fill.input,
                output: fill.output,
                subFills: [fill],
            });
        }
        return this.collapsedFills;
    }

    private _addFillSize(fill: Fill): void {
        if (this._size.input.plus(fill.input).isGreaterThan(this.targetInput)) {
            const remainingInput = this.targetInput.minus(this._size.input);
            const scaledFillOutput = fill.output.times(remainingInput.div(fill.input));
            this._size.input = this.targetInput;
            this._size.output = this._size.output.plus(scaledFillOutput);
            // Penalty does not get interpolated.
            const penalty = fill.adjustedOutput.minus(fill.output);
            this._adjustedSize.input = this.targetInput;
            this._adjustedSize.output = this._adjustedSize.output.plus(scaledFillOutput).plus(penalty);
        } else {
            this._size.input = this._size.input.plus(fill.input);
            this._size.output = this._size.output.plus(fill.output);
            this._adjustedSize.input = this._adjustedSize.input.plus(fill.input);
            this._adjustedSize.output = this._adjustedSize.output.plus(fill.adjustedOutput);
        }
    }
}

export interface CollapsedPath extends Path {
    readonly collapsedFills: ReadonlyArray<CollapsedFill>;
    readonly orders: OptimizedMarketOrder[];
}
