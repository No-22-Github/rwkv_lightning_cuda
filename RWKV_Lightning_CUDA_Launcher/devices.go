package main

// §5.8 visible_devices: GPU selection is done by injecting environment
// variables when the Agent spawns its managed processes, not by adding flags
// to the C++ binaries. CUDA_VISIBLE_DEVICES / HIP_VISIBLE_DEVICES are the
// native, zero-change equivalent of a --device flag.

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// resolvedDevices captures which GPU(s) a managed process is pinned to.
//   - spec     is the raw injected spec ("" when nothing is injected);
//   - explicit is true only when the spec came from the request body or the
//     --card flag. An inherited CUDA_VISIBLE_DEVICES is NOT explicit: its
//     meaning for a child process is not something the Agent can reason about.
type resolvedDevices struct {
	spec     string
	explicit bool
}

// resolveVisibleDevices applies the §5.8 priority chain (highest wins):
//  1. the request body's visible_devices — "" is an explicit "do not inject"
//     and deliberately differs from an absent field, which falls through;
//  2. the Agent's --card default;
//  3. the Agent process's own CUDA/HIP_VISIBLE_DEVICES (children inherit it
//     through os.Environ, nothing is injected here);
//  4. nothing — device 0, the status quo.
func (l *launcher) resolveVisibleDevices(reqVisible *string) resolvedDevices {
	if reqVisible != nil {
		if *reqVisible == "" {
			return resolvedDevices{}
		}
		return resolvedDevices{spec: strings.TrimSpace(*reqVisible), explicit: true}
	}
	if l.card != "" {
		return resolvedDevices{spec: strings.TrimSpace(l.card), explicit: true}
	}
	for _, name := range deviceEnvVars {
		if os.Getenv(name) != "" {
			return resolvedDevices{} // inherited by children as-is
		}
	}
	return resolvedDevices{}
}

var deviceEnvVars = []string{"CUDA_VISIBLE_DEVICES", "HIP_VISIBLE_DEVICES", "ROCR_VISIBLE_DEVICES"}

// parseDeviceSet parses a CUDA_VISIBLE_DEVICES-style spec into device
// indexes. It returns nil for anything that is not a plain comma-separated
// non-negative integer list (UUIDs, MIG selectors, ...): those cannot be
// compared, so callers must treat them as "undeterminable".
func parseDeviceSet(spec string) map[int]bool {
	if spec == "" {
		return nil
	}
	out := map[int]bool{}
	for _, part := range strings.Split(spec, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			return nil
		}
		n, err := strconv.Atoi(part)
		if err != nil || n < 0 {
			return nil
		}
		out[n] = true
	}
	return out
}

// devicesOverlap reports whether two managed GPU processes may end up on the
// same physical card. §5.8(a): when either side is not explicitly pinned the
// answer must be "yes" — a false block costs the user one extra click, a
// false pass costs an OOM mid-training.
func devicesOverlap(a, b resolvedDevices) bool {
	if !a.explicit || !b.explicit {
		return true
	}
	sa, sb := parseDeviceSet(a.spec), parseDeviceSet(b.spec)
	if sa == nil || sb == nil {
		return true
	}
	for d := range sa {
		if sb[d] {
			return true
		}
	}
	return false
}

// applyVisibleDevices rewrites the child environment to pin it to spec.
// The NVIDIA path sets CUDA_VISIBLE_DEVICES; the AMD path sets both
// HIP_VISIBLE_DEVICES and ROCR_VISIBLE_DEVICES (they act at different layers
// and some ROCm releases only honor one). All device variables are removed
// first so a stale inherited value can never combine with the injected one.
func applyVisibleDevices(env []string, spec, vendor string) []string {
	if spec == "" {
		return env
	}
	set := map[string]string{}
	if vendor == vendorAMD {
		set["HIP_VISIBLE_DEVICES"] = spec
		set["ROCR_VISIBLE_DEVICES"] = spec
	} else {
		set["CUDA_VISIBLE_DEVICES"] = spec
	}
	out := make([]string, 0, len(env)+len(set))
	for _, kv := range env {
		key := kv
		if i := strings.IndexByte(kv, '='); i >= 0 {
			key = kv[:i]
		}
		if knownDeviceVar(key) {
			continue // dropped, re-added below with the injected value
		}
		out = append(out, kv)
	}
	// Append in deviceEnvVars order, not map order: deterministic output.
	for _, name := range deviceEnvVars {
		if v, ok := set[name]; ok {
			out = append(out, name+"="+v)
		}
	}
	return out
}

func knownDeviceVar(key string) bool {
	for _, name := range deviceEnvVars {
		if key == name {
			return true
		}
	}
	return false
}

// sanitizeDeviceTag converts a visible_devices spec into a path-safe tag.
func sanitizeDeviceTag(spec string) string {
	var b strings.Builder
	for _, r := range spec {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_':
			b.WriteRune(r)
		default:
			b.WriteRune('-')
		}
	}
	return strings.Trim(b.String(), "-")
}

// deviceTuneCache derives a card-bound default --tune-cache path (§5.8(c)).
// W8A16/W4A16 split-K and sparse thresholds are tuned per GPU: the C++ default
// path already keys on model stem + GPU model name, but two same-model cards
// share that path, so switching visible_devices between them would silently
// reuse the other card's results. The Agent therefore pins the cache next to
// the state DB, named after the model and the device spec. Explicit
// --tune-cache values and dynamic-loading mode are left untouched (§3.3: the
// per-model default naming applies there).
func deviceTuneCache(req startRequest, devices resolvedDevices) string {
	tag := sanitizeDeviceTag(devices.spec)
	if tag == "" || req.EnableDynamicLoading {
		return ""
	}
	model := req.ModelPath
	if !filepath.IsAbs(model) {
		model = filepath.Join(appDir(), model)
	}
	stem := strings.TrimSuffix(filepath.Base(model), filepath.Ext(model))
	if stem == "" {
		return ""
	}
	dir := appDir()
	if p := req.StateDBPath; p != "" {
		if !filepath.IsAbs(p) {
			p = filepath.Join(appDir(), p)
		}
		dir = filepath.Dir(p)
	}
	return filepath.Join(dir, stem+".dev-"+tag+".w8a16.tune")
}
