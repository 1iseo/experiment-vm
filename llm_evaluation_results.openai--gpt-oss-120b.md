# LLM Evaluation Summary

- Base URL: https://ai-gateway.vercel.sh/v4/ai
- Model: openai/gpt-oss-120b
- Manual files: 25
- Completed: 25
- Stale: 0
- Skipped: 0
- Pending: 0
- Updated at: 2026-06-30T10:25:12.796Z

Accuracy (AST-Based): 76.00%

Accuracy (Layered): 4.00%

| File | AST Prediction | AST Conf | AST Result | Layered Prediction | Layered Conf | Layered Result | Status |
|------|----------------|----------|------------|--------------------|--------------|----------------|--------|
| base64_codec.js | base64_codec | 95% | PASS | UNKNOWN | 90% | FAIL | DONE |
| binary_search.js | binary_search | 100% | PASS | switch_dispatch | 90% | FAIL | DONE |
| binary_tree.js | binary_tree | 95% | PASS | switch_dispatch | 92% | FAIL | DONE |
| bubble_sort.js | bubble_sort | 95% | PASS | UNKNOWN | 95% | FAIL | DONE |
| callback_queue.js | cart_total | 55% | FAIL | switch_dispatch | 92% | FAIL | DONE |
| cart_total.js | cart_total | 95% | PASS | UNKNOWN | 92% | FAIL | DONE |
| closured_counters.js | closured_counters | 90% | PASS | UNKNOWN | 90% | FAIL | DONE |
| currency_converter.js | currency_converter | 95% | PASS | UNKNOWN | 95% | FAIL | DONE |
| date_utils.js | date_utils | 95% | PASS | switch_dispatch | 80% | FAIL | DONE |
| deep_if_else.js | base64_codec | 80% | FAIL | UNKNOWN | 95% | FAIL | DONE |
| factorial.js | factorial | 95% | PASS | switch_dispatch | 92% | FAIL | DONE |
| fibonacci.js | fibonacci | 95% | PASS | switch_dispatch | 92% | FAIL | DONE |
| gcd.js | gcd | 90% | PASS | switch_dispatch | 90% | FAIL | DONE |
| input_validator.js | input_validator | 95% | PASS | UNKNOWN | 95% | FAIL | DONE |
| matrix_multiply.js | matrix_multiply | 95% | PASS | UNKNOWN | 90% | FAIL | DONE |
| merge_sort.js | merge_sort | 95% | PASS | switch_dispatch | 70% | FAIL | DONE |
| nested_loops.js | UNKNOWN | 85% | FAIL | UNKNOWN | 90% | FAIL | DONE |
| prime_check.js | prime_check | 95% | PASS | switch_dispatch | 85% | FAIL | DONE |
| quick_sort.js | quick_sort | 95% | PASS | UNKNOWN | 95% | FAIL | DONE |
| recursive_backtrack.js | recursive_backtrack | 95% | PASS | UNKNOWN | 95% | FAIL | DONE |
| string_manipulation.js | string_manipulation | 95% | PASS | switch_dispatch | 92% | FAIL | DONE |
| switch_dispatch.js | UNKNOWN | 80% | FAIL | switch_dispatch | 92% | PASS | DONE |
| tax_calculator.js | tax_calculator | 95% | PASS | switch_dispatch | 80% | FAIL | DONE |
| try_catch_flow.js | UNKNOWN | 80% | FAIL | switch_dispatch | 85% | FAIL | DONE |
| user_auth_mock.js | user_auth_mock | 70% | FAIL | switch_dispatch | 92% | FAIL | DONE |
