# Dataset Benchmark Results

- Measured at: 2026-06-30T10:43:49.032Z
- Node.js: v24.16.0
- Runs: 5 measured + 1 warm-up
- Method: End-to-end Node.js process time including module loading, parsing, VM initialization, test execution, and process shutdown.

## Summary

- Original: average size 0.73 KiB (1.00x), average runtime 84.32 ms (1.00x)
- AST-Based: average size 3.96 KiB (5.40x), average runtime 85.97 ms (1.02x)
- VM: average size 69.35 KiB (94.58x), average runtime 251.52 ms (2.98x)
- Layered: average size 149.35 KiB (203.69x), average runtime 574.40 ms (6.81x)

## Per-file results

| File | Original KiB | AST KiB | VM KiB | Layered KiB | Original ms | AST ms | VM ms | Layered ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| base64_codec.js | 0.74 | 4.33 | 73.17 | 153.37 | 92.10 | 89.84 | 283.00 | 326.90 |
| binary_search.js | 0.77 | 4.33 | 71.06 | 149.58 | 80.78 | 82.20 | 234.35 | 555.66 |
| binary_tree.js | 0.51 | 3.36 | 74.54 | 159.42 | 86.46 | 86.53 | 329.19 | 757.44 |
| bubble_sort.js | 0.39 | 3.24 | 60.83 | 140.87 | 74.04 | 76.31 | 251.53 | 522.70 |
| callback_queue.js | 0.82 | 5.22 | 69.17 | 149.37 | 81.70 | 98.47 | 158.16 | 249.93 |
| cart_total.js | 0.89 | 4.36 | 68.03 | 150.89 | 80.80 | 99.53 | 125.75 | 254.16 |
| closured_counters.js | 0.34 | 2.33 | 53.64 | 125.57 | 95.58 | 95.89 | 94.16 | 133.69 |
| currency_converter.js | 0.49 | 2.94 | 58.23 | 135.44 | 77.32 | 81.10 | 116.47 | 182.52 |
| date_utils.js | 0.77 | 3.94 | 68.41 | 147.13 | 76.87 | 89.33 | 125.25 | 207.48 |
| deep_if_else.js | 0.85 | 3.44 | 66.25 | 145.36 | 87.08 | 78.48 | 122.72 | 206.37 |
| factorial.js | 0.36 | 3.19 | 60.44 | 135.12 | 82.92 | 79.36 | 157.58 | 263.23 |
| fibonacci.js | 0.66 | 4.45 | 66.47 | 146.08 | 84.87 | 89.49 | 567.78 | 1316.53 |
| gcd.js | 0.29 | 3.07 | 60.33 | 135.63 | 84.57 | 77.23 | 128.40 | 223.06 |
| input_validator.js | 1.61 | 6.12 | 92.87 | 182.77 | 90.83 | 77.78 | 343.50 | 953.00 |
| matrix_multiply.js | 0.52 | 3.18 | 66.83 | 144.87 | 87.55 | 84.59 | 286.92 | 629.64 |
| merge_sort.js | 0.77 | 3.65 | 70.97 | 152.32 | 83.64 | 88.98 | 192.61 | 426.42 |
| nested_loops.js | 0.69 | 3.52 | 68.55 | 146.71 | 79.59 | 84.89 | 323.24 | 636.61 |
| prime_check.js | 0.75 | 4.38 | 76.36 | 158.64 | 79.20 | 81.56 | 299.54 | 528.57 |
| quick_sort.js | 0.65 | 4.36 | 73.43 | 156.21 | 78.16 | 85.63 | 174.87 | 394.31 |
| recursive_backtrack.js | 0.82 | 4.54 | 81.60 | 168.56 | 88.08 | 82.97 | 1009.18 | 3221.25 |
| string_manipulation.js | 1.33 | 5.16 | 88.88 | 175.45 | 85.01 | 85.23 | 278.00 | 835.64 |
| switch_dispatch.js | 0.97 | 3.98 | 63.89 | 140.02 | 103.06 | 85.58 | 132.31 | 226.67 |
| tax_calculator.js | 0.81 | 3.29 | 64.04 | 141.49 | 84.75 | 89.72 | 136.49 | 297.83 |
| try_catch_flow.js | 0.86 | 4.49 | 66.88 | 143.06 | 79.49 | 83.60 | 137.90 | 275.51 |
| user_auth_mock.js | 0.66 | 4.11 | 68.95 | 149.96 | 83.63 | 94.86 | 279.12 | 734.82 |
