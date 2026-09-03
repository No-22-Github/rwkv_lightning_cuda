# W8A16 推理优化目标文档回复 / 交接案

对应规格书：`tmp/Handoff_w8a16_gemm_v2.md`。本交接基于 2026-09-03 的最终工作树，
详细逐层数据、原始数字和命令见 `tools/calibration/REPORT.md`。

## 结论

完成了随机独立序列 bench、M1/M2/M3/M4 的 W8A16 路径接线、INT8 cmix 稀疏、
阈值实测、逐 token logits MSE、M0.2、M0.4 和 Gate D 测量。最终阈值设为
`cmix_sparse_max_rows=32`；INT8 在所有测量 batch 都快于 FP16，A/B/C/D
门槛均通过。

## 最终 decode 表

| Batch | FP16 ms | W8A16 ms | W8A16 TPS | TPS gain |
|---:|---:|---:|---:|---:|
| 1 | 38.0710 | 20.6011 | 48.5411 | +84.8008% |
| 2 | 39.9043 | 21.8003 | 91.7419 | +83.0447% |
| 4 | 43.6736 | 24.2221 | 165.1384 | +80.3048% |
| 8 | 46.2152 | 24.7850 | 322.7759 | +86.4644% |
| 16 | 56.1050 | 28.3108 | 565.1553 | +98.1753% |
| 32 | 58.8777 | 36.3014 | 881.5087 | +62.1913% |
| 64 | 65.8315 | 48.8688 | 1309.6290 | +34.7107% |

Bench 固定 seed `1380668983`，每行 32 个随机 prompt token、每行独立 decode token，
预热 3 次、计时 10 次、取中位数；TPS 均按实际 batch 计算。`TPS gain` 统一按
`(W8A16 TPS / FP16 TPS - 1) * 100`，等价于同 batch 下的
`(FP16 ms / W8A16 ms - 1) * 100`；时间降低比例另按
`(FP16 ms - W8A16 ms) / FP16 ms` 计算。表中 W8A16 为启动调优完成后的缓存命中结果。

## 实现与测量要点

- `--cmix-sparse off` 已传到 backend/router；INT8 不再强制进入稀疏路径。
- 运行时 `cmix_sparse_max_rows=32` 延续阈值实验中 B16+B32+B64 总延迟最低的档；
  阈值 12/32/64 的三档分别为 116.4682/114.3468/116.7960 ms。
- M5--8 改走 `gemm<16>` 的 A/B：B8 从 36.4349 ms 降到 35.6344 ms；当前随机
  bench 为 24.7850 ms（新 BM128/资源复用构建）。
- Prefill 的 BM128 kernel 在 `N % 128 == 0` 时使用 BN128，RawKN 共享内存加载使用
  四路列 swizzle；B128 microbench 的四个形状分别为 0.140083/0.474522/0.550000/
  1.87411 ms。1024-token A/B：BN64 控制 503.148 ms；当前缓存命中 BN128 为 450.628 ms。
- 启动调优按 `(K,N,layout,M 档)` 对 `S=1/2/4` 各测 5 次取中位数，并按 GPU 名写入
  `<state-db-directory>/<model-stem>.<gpu-name>.w8a16.tune`；默认与
  `--state-db-path` 同目录（默认即当前工作目录），`--tune-cache` 可指定路径，
  `--retune` 强制重跑。缓存带 `kTuneVersion`，版本不匹配自动重调，并以
  `<path>.tmp` 写完后 rename 覆盖。4060 Ti 的最终选择和 sparse/dense 三档数据详见报告。
- `nsys` 2026.1.3.425 已可用，profile 工具用 `cudaProfilerStart/Stop` 排除预填充。
  修复后 B8-B4 端到端只差 0.5748 ms，kernel sum 为 23.675010/23.734593 ms，
  不再有旧的 8 ms kernel 类。B64 关键 kernel 是 Packed BM64 GEMM 25.099521 ms、
  RawKN FFN-value GEMM 12.601412 ms 和 WKV 7.559697 ms。
- 针对 B64 attention C×C 做过 2-way split-K 原型，结果回归，因此最终路径未强制
  split-K；当前自适应分流对这些 decode 形状保持单份 K。
- 三个真实 prompt 各 decode 64 步的 M0.2 统计显示非零比例约 0.48%--24.62%，
  `max_relu²` 最高 81.7047；按规格公式最大估计 P0/P1/P2 为
  2.34221e11/1.16077e11/1.27163e11，均远超 half 上限 65504。当前 INT8
  稀疏 kernel 用 FP32 寄存器累加后再乘 scale，实际路径没有 raw half2 溢出风险。
- Teacher-forced 逐 token logits：总体 MSE 0.02647262、RMSE 0.16270409，
  top-1 53/54（98.15%）一致；不是 bitwise FP16 对齐。
- Gate D（1024 token、chunk 128）：FP16 512.919 ms / 1996.42 tok/s，W8A16
  450.628 ms / 2272.38 tok/s，INT8 为 0.8786x，通过。

## Gate 状态

| Gate | 结果 |
|---|---|
| A: B1 <=25 ms | 通过，20.6011 ms |
| B: B8 <=32 ms | 通过，24.7850 ms |
| C1: B64 <=58 ms | 通过，48.8688 ms |
| C2: B16/B32/B64 各快 >=15%（TPS gain） | 通过：B16 +98.1753%、B32 +62.1913%、B64 +34.7107% |
| D: prefill INT8 <= FP16 | 通过，450.628 ms vs 512.919 ms |

## 验证

最终代码构建成功；聚焦测试 `rwkv_quantized_archive_test`、
`rwkv_cuda_non4096_kernels_test`、`rwkv_w8a16_kernels_test` 为 3/3 通过，另以
`CMAKE_CUDA_ARCHITECTURES=75` 完成 `build75` 全量编译验证 sm75 fallback。
HTTP server 因环境缺少 Drogon 未生成，故没有 HTTP agreement 数字。
