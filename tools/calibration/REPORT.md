# W8A16 calibration report

Date: 2026-09-03

Hardware: NVIDIA GeForce RTX 4060 Ti 16 GB, sm_89. Model:
`rwkv7-g1j-7.2b-20260831-ctx16384`; FP16 input is
`/home/no22/rwkv_test/models/g1j/rwkv7-g1j-7.2b-20260831-ctx16384.pth` and INT8 input is
`/home/no22/rwkv_test/models/g1j/rwkv7-g1j-7.2b-20260831-ctx16384.w8a16.rwkvq`.
Vocabulary is `/home/no22/rwkv_test/models/rwkv_vocab_v20230424.txt`.

## 1. Decode benchmark

`tools/bench_model.cpp` now uses seed `1380668983`, 32 random vocabulary tokens per
row, a distinct decode token per row, three warmups, and ten samples with the median
of samples 5 and 6. Each batch is a fresh independent state. TPS is the actual
`batch * 1000 / decode_ms`, not single-row latency scaled after the fact. The
`TPS gain` column is `(W8A16 TPS / FP16 TPS - 1) * 100`; for a fixed batch this is
equivalently `(FP16 ms / W8A16 ms - 1) * 100`. `Time reduction` is a separate
metric: `(FP16 ms - W8A16 ms) / FP16 ms * 100`.

| Batch | FP16 ms | W8A16 ms | W8A16 wins ms | FP16 TPS | W8A16 TPS | TPS gain | Time reduction |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 38.0710 | 20.6011 | 17.4699 | 26.2667 | 48.5411 | 84.8008% | 45.8877% |
| 2 | 39.9043 | 21.8003 | 18.1040 | 50.1199 | 91.7419 | 83.0447% | 45.3685% |
| 4 | 43.6736 | 24.2221 | 19.4515 | 91.5885 | 165.1384 | 80.3048% | 44.5383% |
| 8 | 46.2152 | 24.7850 | 21.4302 | 173.1032 | 322.7759 | 86.4644% | 46.3705% |
| 16 | 56.1050 | 28.3108 | 27.7942 | 285.1796 | 565.1553 | 98.1753% | 49.5396% |
| 32 | 58.8777 | 36.3014 | 22.5763 | 543.4995 | 881.5087 | 62.1913% | 38.3444% |
| 64 | 65.8315 | 48.8688 | 16.9627 | 972.1790 | 1309.6290 | 34.7107% | 25.7668% |

The corrected random benchmark removes the old identical-state/L2-reuse artifact.
The W8A16 sweep is a cache-hit run after startup tuning completed.
INT8 wins every measured batch, with 25.7--49.5% lower decode time and 34.6--98.2%
higher actual throughput than FP16.

## 2. Cmix threshold and off switch

The following historical runs use the corrected benchmark and default
`--cmix-sparse no-fc`. The runtime `cmix_sparse_max_rows` selected by the current
startup tuner is 32.

| Threshold (rows) | B16 ms | B32 ms | B64 ms |
|---:|---:|---:|---:|
| 12 | 31.1926 | 35.5161 | 49.7595 |
| 32 | 28.2995 | 36.2812 | 49.7661 |
| 64 | 28.2987 | 36.2907 | 52.2066 |

Threshold 32 has the lowest B16+B32+B64 aggregate (114.3468 ms versus 116.4682
for threshold 12 and 116.7960 for threshold 64): it keeps the B16 sparse win while
leaving B64 on the faster dense path. With `--cmix-sparse off`, INT8 takes the
explicit dense path rather than forcing sparse:

| Option | B16 ms | B32 ms | B64 ms |
|---|---:|---:|---:|
| `--cmix-sparse off` | 31.1715 | 35.4684 | 49.6640 |

### Runtime tuner

On the RTX 4060 Ti, startup tuning measures each candidate split with five timed
runs and stores the median. The selected split-K table is keyed by `(K, N, layout,
M bucket)` and loaded from the GPU-specific cache on subsequent starts. Selected
medians (ms) are:

| Shape | K | N | Layout | M=8 S/ms | M=16 S/ms | M=32 S/ms | M=64 S/ms | M=128 S/ms |
|---|---:|---:|---|---:|---:|---:|---:|---:|
| att C×C | 4096 | 4096 | PackedNK | 1/0.082784 | 1/0.080000 | 1/0.089088 | 1/0.104448 | 1/0.131936 |
| ffn.key | 4096 | 16384 | PackedNK | 1/0.249856 | 1/0.249856 | 1/0.258048 | 1/0.386112 | 1/0.514880 |
| ffn.value | 16384 | 4096 | KN/RawKN | 1/0.253952 | 1/0.257920 | 4/0.281792 | 1/0.393216 | 1/0.528544 |
| head | 4096 | 65536 | PackedNK | 1/0.982176 | 1/0.985856 | 1/0.993280 | 1/1.349340 | 1/1.865730 |

The default path is alongside the service state database,
`<state-db-directory>/<model-stem>.<gpu-name>.w8a16.tune` (the current working
directory when `--state-db-path` is left at its default); an explicit
`--tune-cache PATH` overrides it and `--retune` ignores an existing cache. A cache
hit skips all tuning. With no cache entry, the automatic fallback
uses the specification §2.7 target of at least `2 * SM` resident blocks, subject
to each K split containing at least four BK tiles. The 4060 Ti device information
(SM count and compute major) is queried once per process and reused by all launches.
The cache stores `kTuneVersion`; a version mismatch invalidates the file and reruns
tuning. Writes go to `<cache>.tmp` and are committed with a rename so readers never
observe a partially written cache.

The ffn.value synthetic test uses exactly 15% positive entries (nnz≈15%) and
compares the sparse and dense paths at each requested row count:

| Rows | Sparse ms | Dense ms |
|---:|---:|---:|
| 16 | 0.571392 | 0.266240 |
| 32 | 1.138590 | 0.286720 |
| 64 | 0.984800 | 0.376960 |

Sparse did not win any of these microbenchmarks, so the tuner keeps the proven
runtime fallback of 32 rather than changing the full-model decode behavior based
on a non-representative single-layer result. The value is runtime state, not a
compile-time constant, and is persisted in the same cache file.

The 4060 Ti cache selects the same split table as the prior hand-tuned settings
(S=1 everywhere except ffn.value at M=32, S=4). The cache-hit decode sweep below
therefore stays within the requested ±2% envelope for every batch; no batch
regressed against the hand-tuned reference.

The current prefill path also uses a BM128 kernel with BN128 whenever `N` is a
multiple of 128; other shapes retain BN64. RawKN shared-memory loads use the same
four-way column swizzle on write and read. The standalone B128 measurements are:

| K | N | W8A16 ms | FP16 ms | W8A16/FP16 |
|---:|---:|---:|---:|---:|
| 4096 | 4096 | 0.140083 | 0.119046 | 0.849826x |
| 4096 | 16384 | 0.474522 | 0.550912 | 1.16098x |
| 16384 | 4096 | 0.550000 | 0.528576 | 0.961047x |
| 4096 | 65536 | 1.87411 | 2.13238 | 1.13781x |

For the 1024-token prefill workload, the BN64 control was 503.148 ms while the
BN128 path measured 450.628 ms in the final cache-hit run; the control is included only as
an A/B diagnostic, not as a gate result.

## 3. Generation and logit consistency

Teacher-forced comparison uses the same token sequence on FP16 and W8A16, so an
early sampled divergence cannot contaminate later MSE. Three prompts contain 18,
14, and 22 tokens respectively.

| Prompt | Tokens | Logit MSE | RMSE | MAE | Max absolute error |
|---|---:|---:|---:|---:|---:|
| Chinese matrix explanation | 18 | 0.02106117 | 0.14512467 | 0.11487870 | 1.7500 |
| English sky dialogue | 14 | 0.02155056 | 0.14680109 | 0.09837491 | 2.015625 |
| C++ code explanation | 22 | 0.03403240 | 0.18447873 | 0.15007168 | 2.09375 |
| Overall | 54 | 0.02647262 | 0.16270409 | — | — |

Per-token MSE (step starts at zero):

```text
P0: 0.07209704, 0.03296123, 0.02076246, 0.00831167, 0.00657114,
    0.01199938, 0.00709597, 0.02489644, 0.05672476, 0.01575059,
    0.00711248, 0.00609224, 0.04937064, 0.02451442, 0.01246426,
    0.00566741, 0.00548477, 0.01122414
P1: 0.15553425, 0.00762357, 0.00510170, 0.02757171, 0.00339784,
    0.00342223, 0.00431382, 0.00424543, 0.00563418, 0.00856679,
    0.00899187, 0.03002786, 0.02289837, 0.01437821
P2: 0.14449262, 0.06099923, 0.05335579, 0.02975282, 0.03388845,
    0.01355346, 0.05997811, 0.02368714, 0.06037806, 0.01699326,
    0.00601774, 0.01352586, 0.01116715, 0.01690258, 0.02132757,
    0.02743051, 0.08628201, 0.01835456, 0.01335953, 0.01169029,
    0.00735230, 0.01822381
```

Top-1 is equal on 53/54 teacher-forced steps (98.15%); the only split is P0 step 9,
where FP16 selects token 19137 and W8A16 selects token 10080. A repeated run can
vary in the last digits because sparse atomic updates are order-dependent; this run's
overall MSE is 0.02647262. This is numerical approximation, not bitwise FP16
alignment, and independent autoregressive generations are not guaranteed to remain
identical.

## 4. M0.2: relu² sparsity and half2 range

`build89/rwkv_cmix_stats MODEL VOCAB PROMPT_INDEX` runs each real prompt for 64
greedy decode steps and reports decode-only T=1 statistics. Prompt 0 is
`请用一段简短中文说明矩阵乘法的作用。` (18 tokens), prompt 1 is
`User: Explain why the sky appears blue.\nAssistant:` (14 tokens), and prompt 2 is the
C++ explanation prompt (22 tokens). The table reports `nonzero / total` and
`max_relu²` for each layer; each total is 1,048,576 (= 64 * F).

| Layer | P0 ratio | P0 max | P1 ratio | P1 max | P2 ratio | P2 max |
|---:|---:|---:|---:|---:|---:|---:|
| 0 | 0.006860 | 0.262856 | 0.004754 | 0.246109 | 0.006657 | 0.234619 |
| 1 | 0.017499 | 0.582449 | 0.008246 | 0.321923 | 0.016148 | 0.316956 |
| 2 | 0.021429 | 0.518709 | 0.014079 | 0.467300 | 0.019460 | 0.327488 |
| 3 | 0.034324 | 0.614938 | 0.023136 | 0.581704 | 0.026189 | 0.323032 |
| 4 | 0.034666 | 0.985405 | 0.026749 | 0.290588 | 0.030129 | 0.737686 |
| 5 | 0.032280 | 1.029510 | 0.022631 | 0.405411 | 0.025047 | 0.405411 |
| 6 | 0.038754 | 1.003910 | 0.025910 | 0.490273 | 0.029250 | 1.087780 |
| 7 | 0.049499 | 3.162420 | 0.038314 | 0.777635 | 0.043701 | 0.587678 |
| 8 | 0.057777 | 2.727010 | 0.045617 | 1.482970 | 0.048842 | 1.051430 |
| 9 | 0.064756 | 2.350710 | 0.057540 | 0.712738 | 0.059664 | 1.147660 |
| 10 | 0.096434 | 3.626350 | 0.082011 | 1.047420 | 0.093075 | 1.666720 |
| 11 | 0.099833 | 5.931890 | 0.092063 | 1.093900 | 0.101422 | 1.102090 |
| 12 | 0.105507 | 16.758800 | 0.103507 | 4.278110 | 0.107869 | 1.969310 |
| 13 | 0.130792 | 7.508880 | 0.134192 | 2.165840 | 0.138994 | 2.536930 |
| 14 | 0.170806 | 21.102500 | 0.170273 | 2.212080 | 0.178533 | 2.180240 |
| 15 | 0.196871 | 11.128500 | 0.195912 | 2.827920 | 0.219882 | 2.991140 |
| 16 | 0.221035 | 21.463000 | 0.212017 | 2.300080 | 0.246186 | 7.627090 |
| 17 | 0.205436 | 9.949590 | 0.206941 | 7.243670 | 0.239519 | 2.593230 |
| 18 | 0.207355 | 5.799440 | 0.208490 | 2.401890 | 0.237905 | 5.931890 |
| 19 | 0.217607 | 25.195700 | 0.206417 | 4.118050 | 0.242217 | 5.230870 |
| 20 | 0.200228 | 11.722600 | 0.196334 | 7.844380 | 0.223335 | 6.859900 |
| 21 | 0.190865 | 39.013700 | 0.182026 | 15.797500 | 0.198838 | 12.072900 |
| 22 | 0.171824 | 20.995000 | 0.150489 | 16.251000 | 0.167466 | 17.929900 |
| 23 | 0.174201 | 14.253600 | 0.147101 | 14.431100 | 0.164701 | 23.047500 |
| 24 | 0.160253 | 18.834200 | 0.126044 | 14.759400 | 0.138605 | 20.250000 |
| 25 | 0.144929 | 38.770100 | 0.117926 | 24.805100 | 0.111320 | 20.638600 |
| 26 | 0.142021 | 25.392200 | 0.119270 | 24.610900 | 0.105736 | 23.765600 |
| 27 | 0.156465 | 22.009300 | 0.124364 | 47.750300 | 0.114947 | 31.377500 |
| 28 | 0.163433 | 26.748300 | 0.128558 | 25.078200 | 0.112926 | 29.992700 |
| 29 | 0.169364 | 56.837500 | 0.124629 | 47.912400 | 0.127235 | 44.046000 |
| 30 | 0.162509 | 70.928000 | 0.121843 | 69.097700 | 0.112885 | 81.704700 |
| 31 | 0.223857 | 78.765600 | 0.201397 | 28.015500 | 0.161231 | 36.470300 |

For each layer the implementation also evaluates the specification formula
`max_relu² * (ratio * F) * 127 / min(scale[c])`. The maximum estimates are:

| Prompt | Maximum estimate | Layer | Half limit |
|---|---:|---:|---:|
| P0 | 2.34221e11 | 31 | 65504 |
| P1 | 1.16077e11 | 30 | 65504 |
| P2 | 1.27163e11 | 30 | 65504 |

All three exceed 65504 by many orders of magnitude, so the formula says the raw
INT8 half2 accumulation has overflow risk. The current INT8 sparse implementation
uses FP32 registers and applies the per-channel scale before the half2 atomic write,
so this particular overflow mechanism is avoided in the shipped path. The result is
not evidence that a raw half2 implementation would be safe; the specification's
`2^-k` pre-scale remains required if that implementation is reinstated.

## 5. M0.4: Nsight kernel attribution

`nsys` is NVIDIA Nsight Systems 2026.1.3.425. `rwkv_profile_model` brackets only the
target decode with `cudaProfilerStart/Stop`, excluding model loading and the 32-token
warmup prefill. The kernel-name totals below are sums over one captured decode; the
wall-clock values in section 1 remain the authoritative benchmark numbers.

| Precision/batch | Kernel sum (ms) | Instances |
|---|---:|---:|
| INT8 B4 | 23.675010 | 516 |
| INT8 B8 | 23.734593 | 928 |
| INT8 B64 | 49.210617 | 928 |
| FP16 B4 | 42.628386 | 516 |
| FP16 B8 | 43.492653 | 928 |
| FP16 B64 | 65.200732 | 960 |

The largest kernel-name aggregates are:

| Precision/batch | Kernel name (demangled template shortened only for readability) | Instances | Total ms |
|---|---|---:|---:|
| INT8 B4 | `w8a16_mma_kernel<16,Packed>` | 161 | 17.241731 |
| INT8 B4 | `cmix_sparse_spmv_relu_rows_i8_kernel` | 32 | 1.883485 |
| INT8 B4 | `linear_wagv_rank_out_f16_kernel<128,4>` | 31 | 2.245488 |
| INT8 B4 | `linear_wagv_rank_in_f16_kernel<256>` | 31 | 1.517418 |
| INT8 B4 | `wkv_fp16_one_cp_kernel` | 32 | 0.340434 |
| INT8 B8 | `w8a16_mma_kernel<16,Packed>` | 161 | 17.319306 |
| INT8 B8 | `cmix_sparse_spmv_relu_rows_t1024_i8_kernel<1024,512>` | 32 | 2.817607 |
| INT8 B8 | `cutlass wmma f16 16x16x16 nn` | 190 | 1.114839 |
| INT8 B8 | `wkv_fp16_one_cp_kernel` | 32 | 0.654240 |
| INT8 B8 | `cutlass wmma f16 32x32x16 nn` | 32 | 0.632991 |
| INT8 B8 | `cutlass tensorop f16 64x64 nn` | 32 | 0.573373 |
| INT8 B64 | `w8a16_mma_kernel<64,Packed>` | 161 | 25.099521 |
| INT8 B64 | `w8a16_mma_kernel<64,RawKN>` | 32 | 12.601412 |
| INT8 B64 | `wkv_fp16_one_cp_kernel` | 32 | 7.559697 |
| INT8 B64 | `cutlass tensorop f16 128x64 nn` | 127 | 1.156665 |
| INT8 B64 | `cutlass tensorop f16 64x64 nn` | 127 | 1.101881 |
| FP16 B4 | `cutlass wmma f16 16x16x16 tn` | 33 | 18.171141 |
| FP16 B4 | `cutlass wmma f16 32x32x16 tn` | 128 | 16.314540 |
| FP16 B4 | `cmix_sparse_spmv_relu_rows_kernel` | 32 | 3.297764 |
| FP16 B4 | `linear_wagv_rank_out_f16_kernel<128,4>` | 31 | 2.346163 |
| FP16 B4 | `linear_wagv_rank_in_f16_kernel<256>` | 31 | 1.660146 |
| FP16 B4 | `wkv_fp16_one_cp_kernel` | 32 | 0.325360 |
| FP16 B8 | `cutlass wmma f16 16x16x16 tn` | 33 | 18.417205 |
| FP16 B8 | `cutlass wmma f16 32x32x16 tn` | 128 | 16.492721 |
| FP16 B8 | `cmix_sparse_spmv_relu_rows_t512_kernel` | 32 | 5.152257 |
| FP16 B8 | `cutlass wmma f16 16x16x16 nn` | 190 | 1.053117 |
| FP16 B8 | `wkv_fp16_one_cp_kernel` | 32 | 0.577786 |
| FP16 B8 | `cutlass tensorop f16 64x64 nn` | 32 | 0.550618 |
| FP16 B64 | `cutlass wmma f16 32x32x16 tn` | 128 | 19.087575 |
| FP16 B64 | `ampere fp16 s1688gemm 256x64 tn` | 32 | 16.978982 |
| FP16 B64 | `cutlass f16 relu 256x64 tn` | 32 | 16.383274 |
| FP16 B64 | `wkv_fp16_one_cp_kernel` | 32 | 6.375614 |

The corrected profile no longer shows an extra 8 ms B8 kernel class: kernel sums are
23.675010 ms (B4) and 23.734593 ms (B8), while the end-to-end benchmark difference
is only 0.5748 ms (24.7956 vs 24.2208 ms). The old B8 discrepancy was a stale
profile captured before the M=5..8 GEMM<16> dispatch; that A/B test measured 35.6344
ms versus 36.4349 ms. At B64, the dominant kernels are packed BM64 INT8 GEMM
(25.099521 ms), dense RawKN FFN-value (12.601412 ms), and WKV (7.559697 ms).
Together they explain the roughly 23 ms above the approximately 27 ms bandwidth floor; the remaining gap is
distributed across rank, layer-norm, and launch work rather than one missing kernel.

## 6. Gate D: 1024-token prefill

`rwkv_prefill_bench` uses the same seed `1380668983`, one sequence, 1024 random
tokens split into eight chunks of 128, one warmup, and three timed runs (median).
The timer starts after state allocation and ends when the final chunk returns logits,
matching the server's prefill-to-first-token sampling point.

| Precision | First-token/prefill ms | Prefill tok/s | Ratio to FP16 |
|---|---:|---:|---:|
| FP16 | 512.919 | 1996.42 | 1.0000x |
| W8A16 | 450.628 | 2272.38 | 0.8786x |

Gate D passes: INT8 is 13.82% faster than FP16 for this prefill case.

## 7. Gate status

| Gate | Requirement | Result |
|---|---|---|
| A | B1 decode <= 25 ms | **Pass**, 20.6011 ms |
| B | B8 decode <= 32 ms | **Pass**, 24.7850 ms |
| C1 | B64 decode <= 58 ms | **Pass**, 48.8688 ms |
| C2 | B16/B32/B64 each >=15% faster than FP16 (TPS gain) | **Pass**, +98.1753% / +62.1913% / +34.7107% |
| D | 1024-token/chunk-128 INT8 first token <= FP16 | **Pass**, 450.628 ms vs 512.919 ms |

Focused validation after the final code build:

```text
ctest --test-dir build89 -R 'rwkv_(w8a16_kernels|quantized_archive|cuda_non4096_kernels)_test' --output-on-failure
3/3 passed (rwkv_w8a16_kernels_test: 46.69 s)
```

An additional `CMAKE_CUDA_ARCHITECTURES=75` configure and full build completed in
`build75`, confirming the sm75 fallback compiles (the BM128 MMA path is selected only
for sm80+). The HTTP server target is not built because Drogon is unavailable in this
environment.
