import { BigNumber } from '@0x/utils';
import { Fill, FillAdjustor } from './types';

export class IdentityFillAdjustor implements FillAdjustor {
    public adjustFills(fills: Fill[], takerToken: string, makerToken: string, amount: BigNumber): Fill[] {
        return fills;
    }
}
