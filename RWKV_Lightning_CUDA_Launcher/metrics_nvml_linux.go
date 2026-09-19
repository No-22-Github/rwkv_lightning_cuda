//go:build linux && cgo

package main

// NVML sampling via dlopen (§5.7). The library is resolved at runtime so the
// same binary runs on machines without NVIDIA drivers, and no build-time
// CUDA toolkit is required — only a C toolchain and libdl. Indexes here are
// NVML physical indexes; CUDA_VISIBLE_DEVICES remaps indexes inside the
// child process, which is why the launcher reports the raw visible_devices
// string alongside (§5.8(b)) and never rewrites child logs.

/*
#cgo LDFLAGS: -ldl

#include <dlfcn.h>

typedef int nvmlReturn_t;
typedef struct { unsigned long long total; unsigned long long free; unsigned long long used; } nvmlMemory_t;
typedef struct { unsigned int gpu; unsigned int memory; } nvmlUtilization_t;

static void *nvml_lib = 0;
static nvmlReturn_t (*p_nvmlInit_v2)(void);
static nvmlReturn_t (*p_nvmlDeviceGetCount_v2)(unsigned int *);
static nvmlReturn_t (*p_nvmlDeviceGetHandleByIndex_v2)(unsigned int, void **);
static nvmlReturn_t (*p_nvmlDeviceGetName)(void *, char *, unsigned int);
static nvmlReturn_t (*p_nvmlDeviceGetMemoryInfo)(void *, nvmlMemory_t *);
static nvmlReturn_t (*p_nvmlDeviceGetUtilizationRates)(void *, nvmlUtilization_t *);
static nvmlReturn_t (*p_nvmlDeviceGetTemperature)(void *, unsigned int, unsigned int *);
static nvmlReturn_t (*p_nvmlDeviceGetPowerUsage)(void *, unsigned int *);

static int nvml_load(void) {
	if (nvml_lib) return 0;
	nvml_lib = dlopen("libnvidia-ml.so.1", RTLD_NOW);
	if (!nvml_lib) nvml_lib = dlopen("libnvidia-ml.so", RTLD_NOW);
	if (!nvml_lib) return -1;
	p_nvmlInit_v2 = (nvmlReturn_t (*)(void))dlsym(nvml_lib, "nvmlInit_v2");
	if (!p_nvmlInit_v2) return -2;
	p_nvmlDeviceGetCount_v2 = (nvmlReturn_t (*)(unsigned int *))dlsym(nvml_lib, "nvmlDeviceGetCount_v2");
	if (!p_nvmlDeviceGetCount_v2) return -2;
	p_nvmlDeviceGetHandleByIndex_v2 = (nvmlReturn_t (*)(unsigned int, void **))dlsym(nvml_lib, "nvmlDeviceGetHandleByIndex_v2");
	if (!p_nvmlDeviceGetHandleByIndex_v2) return -2;
	p_nvmlDeviceGetName = (nvmlReturn_t (*)(void *, char *, unsigned int))dlsym(nvml_lib, "nvmlDeviceGetName");
	if (!p_nvmlDeviceGetName) return -2;
	p_nvmlDeviceGetMemoryInfo = (nvmlReturn_t (*)(void *, nvmlMemory_t *))dlsym(nvml_lib, "nvmlDeviceGetMemoryInfo");
	if (!p_nvmlDeviceGetMemoryInfo) return -2;
	p_nvmlDeviceGetUtilizationRates = (nvmlReturn_t (*)(void *, nvmlUtilization_t *))dlsym(nvml_lib, "nvmlDeviceGetUtilizationRates");
	if (!p_nvmlDeviceGetUtilizationRates) return -2;
	p_nvmlDeviceGetTemperature = (nvmlReturn_t (*)(void *, unsigned int, unsigned int *))dlsym(nvml_lib, "nvmlDeviceGetTemperature");
	if (!p_nvmlDeviceGetTemperature) return -2;
	p_nvmlDeviceGetPowerUsage = (nvmlReturn_t (*)(void *, unsigned int *))dlsym(nvml_lib, "nvmlDeviceGetPowerUsage");
	if (!p_nvmlDeviceGetPowerUsage) return -2;
	return 0;
}

static nvmlReturn_t c_nvml_init(void) { return p_nvmlInit_v2(); }
static nvmlReturn_t c_nvml_count(unsigned int *n) { return p_nvmlDeviceGetCount_v2(n); }
static nvmlReturn_t c_nvml_handle(unsigned int i, void **dev) { return p_nvmlDeviceGetHandleByIndex_v2(i, dev); }
static nvmlReturn_t c_nvml_name(void *dev, char *buf, unsigned int len) { return p_nvmlDeviceGetName(dev, buf, len); }
static nvmlReturn_t c_nvml_memory(void *dev, unsigned long long *total, unsigned long long *used) {
	nvmlMemory_t m;
	nvmlReturn_t rc = p_nvmlDeviceGetMemoryInfo(dev, &m);
	if (rc == 0) { *total = m.total; *used = m.used; }
	return rc;
}
static nvmlReturn_t c_nvml_util(void *dev, unsigned int *gpu) {
	nvmlUtilization_t u;
	nvmlReturn_t rc = p_nvmlDeviceGetUtilizationRates(dev, &u);
	if (rc == 0) *gpu = u.gpu;
	return rc;
}
static nvmlReturn_t c_nvml_temp(void *dev, unsigned int *c) { return p_nvmlDeviceGetTemperature(dev, 0, c); } // 0 = NVML_TEMPERATURE_GPU
static nvmlReturn_t c_nvml_power(void *dev, unsigned int *mw) { return p_nvmlDeviceGetPowerUsage(dev, mw); }
*/
import "C"

import (
	"fmt"
	"sync"
	"unsafe"
)

var nvmlOnce struct {
	once sync.Once
	err  error
}

// nvmlInit loads libnvidia-ml and initializes NVML exactly once. The handle
// stays open for the process lifetime; sampling calls are cheap and NVML is
// documented thread-safe.
func nvmlInit() error {
	nvmlOnce.once.Do(func() {
		if rc := C.nvml_load(); rc != 0 {
			if rc == -1 {
				nvmlOnce.err = fmt.Errorf("NVML library not found (libnvidia-ml.so.1)")
			} else {
				nvmlOnce.err = fmt.Errorf("NVML symbols missing in libnvidia-ml")
			}
			return
		}
		if rc := C.c_nvml_init(); rc != 0 {
			nvmlOnce.err = fmt.Errorf("NVML init failed: %s", nvmlErrorString(int(rc)))
		}
	})
	return nvmlOnce.err
}

func nvmlSample() ([]gpuSample, error) {
	if err := nvmlInit(); err != nil {
		return nil, err
	}
	var n C.uint
	if rc := C.c_nvml_count(&n); rc != 0 {
		return nil, fmt.Errorf("nvmlDeviceGetCount_v2: %s", nvmlErrorString(int(rc)))
	}
	gpus := []gpuSample{}
	for i := 0; i < int(n); i++ {
		var dev unsafe.Pointer
		if rc := C.c_nvml_handle(C.uint(i), &dev); rc != 0 {
			return nil, fmt.Errorf("nvmlDeviceGetHandleByIndex_v2: %s", nvmlErrorString(int(rc)))
		}
		gpu := gpuSample{Index: i}
		name := make([]C.char, 128)
		if rc := C.c_nvml_name(dev, &name[0], C.uint(len(name))); rc == 0 {
			gpu.Name = C.GoString(&name[0])
		}
		var total, used C.ulonglong
		if rc := C.c_nvml_memory(dev, &total, &used); rc == 0 {
			gpu.MemoryTotalBytes = uint64(total)
			gpu.MemoryUsedBytes = uint64(used)
		}
		var util C.uint
		if rc := C.c_nvml_util(dev, &util); rc == 0 {
			gpu.UtilizationPercent = int(util)
		}
		// Optional sensors: NOT_SUPPORTED simply omits the field (§6.3).
		var temp C.uint
		if rc := C.c_nvml_temp(dev, &temp); rc == 0 {
			t := int(temp)
			gpu.TemperatureC = &t
		}
		var mw C.uint
		if rc := C.c_nvml_power(dev, &mw); rc == 0 {
			p := int(mw) / 1000
			gpu.PowerWatts = &p
		}
		gpus = append(gpus, gpu)
	}
	if len(gpus) == 0 {
		return nil, fmt.Errorf("NVML reported zero devices")
	}
	return gpus, nil
}

func nvmlErrorString(rc int) string {
	switch rc {
	case 0:
		return "success"
	case 1:
		return "uninitialized"
	case 2:
		return "invalid argument"
	case 3:
		return "not supported"
	case 4:
		return "no permission"
	case 5:
		return "already initialized"
	case 6:
		return "not found"
	case 7:
		return "insufficient size"
	case 8:
		return "insufficient power"
	case 9:
		return "driver not loaded"
	case 10:
		return "timeout"
	case 12:
		return "library not found"
	case 13:
		return "function not found"
	case 14:
		return "corrupted inforom"
	case 15:
		return "gpu lost"
	default:
		return fmt.Sprintf("error %d", rc)
	}
}
