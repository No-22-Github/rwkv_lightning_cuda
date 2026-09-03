# CUDA W8A16 quantization

`modeling/rwkv_quantize.cpp` implements the standalone `rwkv_quantize` command
and the streaming `.rwkvq` container. Linear tensors use per-output-channel
symmetric INT8 weights with one FP16 scale per output row. Non-linear tensors,
embeddings, layer norms, and low-rank factors are stored as BF16.

`gemmv/rwkv_w8a16.cu` contains the CUDA W8A16 GEMV used directly by the
inference backend. The kernel consumes the INT8 weights and scales without a
full-model dequantization buffer. At runtime the CUDA backend selects a batched
GEMV for up to eight rows and a WMMA GEMM for larger batches. `ffn.value` is
transposed once while loading and is consumed through the `KN` layout variant;
the on-disk `.rwkvq` format remains unchanged. Quantized `ffn.value` also uses
the existing sparse ReLU path through 64 rows, with a wider output tile for
large batches.
