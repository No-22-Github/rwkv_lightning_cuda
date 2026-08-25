# HIP backend

This directory contains the ROCm/HIP port of the inference backend and its GPU kernels.
Configure it with:

```sh
cmake -S . -B build-hip -DRWKV_GPU_BACKEND=HIP -DCMAKE_BUILD_TYPE=Release
cmake --build build-hip -j
ctest --test-dir build-hip --output-on-failure
```

The CUDA backend remains the default. HIP sources are kept separate so backend-specific
kernel tuning can evolve without changing the CUDA implementation.

The port's warp-oriented kernels are currently validated with the native 32-lane
wavefront mode on `gfx1100`; other AMD architectures require correctness testing.
