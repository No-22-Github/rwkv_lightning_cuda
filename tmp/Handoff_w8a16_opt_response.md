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
| 1 | 38.0691 | 20.6220 | 48.4919 | +84.6043% |
| 2 | 39.9039 | 21.8185 | 91.6653 | +82.8902% |
| 4 | 43.6685 | 24.2293 | 165.0894 | +80.2301% |
| 8 | 46.1859 | 24.8054 | 322.5104 | +86.1929% |
| 16 | 56.0823 | 28.6889 | 557.7070 | +95.4843% |
| 32 | 58.8945 | 33.8133 | 946.3732 | +74.1755% |
| 64 | 65.8202 | 40.7663 | 1569.9242 | +61.4574% |

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
  bench 为 24.8054 ms（版本 4 cache-hit，新 BM64×BN128 三阶段流水构建）。
- Prefill 的 BM128 kernel 在 `N % 128 == 0` 时使用 BN128，RawKN 共享内存加载使用
  四路列 swizzle；B128 microbench 的四个形状分别为 0.140083/0.474522/0.550000/
  1.87411 ms。历史 1024-token A/B 为 503.148/450.628 ms；本轮复测为 FP16
  512.869 ms、INT8 450.836 ms（chunk 128）。
- 启动调优按 `(K,N,layout,M 档)` 对 `S=1/2/4` 各测 5 次取中位数，并按 GPU 名写入
  `<state-db-directory>/<model-stem>.<gpu-name>.w8a16.tune`；默认与
  `--state-db-path` 同目录（默认即当前工作目录），`--tune-cache` 可指定路径，
  `--retune` 强制重跑。缓存带 `kTuneVersion=4`，版本不匹配自动重调，并以
  `<path>.tmp` 写完后 rename 覆盖。4060 Ti 的最终选择和 sparse/dense 三档数据详见报告。
- `nsys` 2026.1.3.425 已可用，profile 工具用 `cudaProfilerStart/Stop` 排除预填充。
  修复后 B8-B4 端到端只差 0.5761 ms，kernel sum 为 23.677919/23.738567 ms，
  不再有旧的 8 ms kernel 类。B64 当前关键 kernel 是 BM64xBN128 Packed GEMM
  18.885829 ms、RawKN BM64xBN128 4.479509 ms、稀疏 value 4.474198 ms 和 WKV
  7.390786 ms；总 kernel sum 为 39.206702 ms（956 次 launch）。
- 针对 B64 attention C×C 做过 2-way split-K 原型，结果回归，因此最终路径未强制
  split-K；当前自适应分流对这些 decode 形状保持单份 K。
- 三个真实 prompt 各 decode 64 步的 M0.2 统计显示非零比例约 0.48%--24.62%，
  `max_relu²` 最高 81.7047；按规格公式最大估计 P0/P1/P2 为
  2.34221e11/1.16077e11/1.27163e11，均远超 half 上限 65504。当前 INT8
  稀疏 kernel 用 FP32 寄存器累加后再乘 scale，实际路径没有 raw half2 溢出风险。
- Teacher-forced 逐 token logits：总体 MSE 0.02647262、RMSE 0.16270409，
  top-1 53/54（98.15%）一致；不是 bitwise FP16 对齐。
- Gate D（1024 token、chunk 128）：FP16 512.869 ms / 1996.61 tok/s，W8A16
  450.836 ms / 2271.33 tok/s，INT8 为 0.8786x，通过。
- Drogon 已在 Arch 环境补装，HTTP server 已重建。相同 31-token 中文 prompt、64
  token 输出、`temperature=0.001/top_k=1/top_p=1` 下，五次请求中位端到端耗时为
  FP16 2.493964 s（25.661953 TPS），INT8 1.358769 s（47.101447 TPS），实际
  HTTP TPS 提升 `(INT8/FP16-1)*100` = **83.5458%（1.8355x）**；服务状态中的
  decode TPS 为 26.322043 vs 48.559672，提升 84.4829%。两模型因显存不足按顺序
  启动。三段 HTTP 自回归字符 agreement 为 1.000/0.064/0.689（首差异：无/2/61），
  详见 `tools/calibration/REPORT.md`；API 全量 smoke test 通过。
- Review follow-up：4060 Ti 上验证并保留 BM64×BN128、(M,N) warp 铺排的无跨 warp
  归约 kernel，三阶段 async pipeline 的 B64 INT8 cache-hit 为 40.77 ms；
  `__launch_bounds__(256,2)` 使该 kernel Packed 寄存器 105→90。按层 cmix 阈值
  写入 tune cache（版本 4），当前 B32/B64 为 34.21/40.77 ms，强制全层阈值 32
  为 36.32/41.34 ms；与版本 4 手调 split 表相比，B1..B64 全表差异在
  -0.14%..+1.22% 内；chunk=256
  prefill 的 BM128 分支 459.3 ms，较旧
  BM64 fallback 596.5 ms。追加小 M A/B 后，M=16 使用 BM64×BN128 会使 B16
  慢 2.60%，因此维持 gemm<16>；M=32 使用 BM64×BN128 使 B32 中位数由
  34.2084 ms 降至 33.8133 ms（TPS 提升约 1.17%），已保留 M=32-only 调度。
  P2/P9 无稳定收益，P10 暂未改。完整细节及未达成项见
  `tools/calibration/REPORT.md` §9。

## Gate 状态

| Gate | 结果 |
|---|---|
| A: B1 <=25 ms | 通过，20.6220 ms |
| B: B8 <=32 ms | 通过，24.8054 ms |
| C1: B64 <=58 ms | 通过，40.7663 ms |
| C2: B16/B32/B64 各快 >=15%（TPS gain） | 通过：B16 +95.4843%、B32 +74.1755%、B64 +61.4574% |
| D: prefill INT8 <= FP16 | 通过，450.836 ms vs 512.869 ms |

## 验证

最终代码构建成功；聚焦测试 `rwkv_quantized_archive_test`、
`rwkv_cuda_non4096_kernels_test`、`rwkv_w8a16_kernels_test` 为 3/3 通过，另以
`CMAKE_CUDA_ARCHITECTURES=75` 完成 `build75` 全量编译验证 sm75 fallback。
HTTP server 已在安装 Drogon 后由 `build89` 成功生成并运行；
`test/api_endpoints_test.sh` 全部 endpoint 检查通过。
