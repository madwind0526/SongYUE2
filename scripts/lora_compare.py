"""Relative difference between two LoRA files (the EMA result and the raw result of one training run).

Prints one JSON line: {"tensors": n, "relative": overall, "largest": worst tensor, "largestKey": name, "zeroReference": tensors that are all zero in the second file}.
`relative` is null when the second file is all zero but the files differ (a ratio cannot be computed).
Run with the ComfyUI Python (it has torch and safetensors): python scripts/lora_compare.py <ema.safetensors> <raw.safetensors>
"""
import json
import sys

import torch
from safetensors import safe_open


def main() -> None:
    a_path, b_path = sys.argv[1], sys.argv[2]
    total_diff = 0.0
    total_norm = 0.0
    worst = 0.0
    worst_key = ''
    count = 0
    zero_reference = 0
    with safe_open(a_path, 'pt') as fa, safe_open(b_path, 'pt') as fb:
        keys = list(fa.keys())
        if set(keys) != set(fb.keys()):
            print(json.dumps({'error': 'the two files do not have the same tensors'}))
            return
        for key in keys:
            ta = fa.get_tensor(key).float()
            tb = fb.get_tensor(key).float()
            diff = (ta - tb).norm().item()
            norm = tb.norm().item()
            total_diff += diff ** 2
            total_norm += norm ** 2
            if norm == 0 and diff > 0:
                zero_reference += 1
            if norm > 0 and diff / norm > worst:
                worst = diff / norm
                worst_key = key
            count += 1
    if total_norm > 0:
        relative = (total_diff ** 0.5) / (total_norm ** 0.5)
    else:
        relative = None if total_diff > 0 else 0.0
    print(json.dumps({'tensors': count, 'relative': relative, 'largest': worst, 'largestKey': worst_key, 'zeroReference': zero_reference}))


if __name__ == '__main__':
    main()
