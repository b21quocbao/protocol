import { BigNumber } from '@0x/utils';

import { ERC20BridgeSource, Fill } from '../src/utils/market_operation_utils/types';

const createFill = (
    source: ERC20BridgeSource,
    index: number = 0,
    input: BigNumber = new BigNumber(100),
    output: BigNumber = new BigNumber(100),
): Fill =>
    // tslint:disable-next-line: no-object-literal-type-assertion
    ({
        source,
        input,
        output,
        adjustedOutput: output,
        flags: BigInt(0),
        sourcePathId: source,
        index,
    } as Fill);

describe('Path', () => {});
