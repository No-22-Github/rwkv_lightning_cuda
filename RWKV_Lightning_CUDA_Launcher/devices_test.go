package main

import (
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestParseDeviceSet(t *testing.T) {
	for spec, want := range map[string][]int{
		"0":     {0},
		"1":     {1},
		"0,1":   {0, 1},
		" 0 ,1": {0, 1},
	} {
		set := parseDeviceSet(spec)
		if set == nil {
			t.Fatalf("parse(%q) failed", spec)
		}
		for _, d := range want {
			if !set[d] {
				t.Fatalf("parse(%q) missing %d", spec, d)
			}
		}
	}
	for _, spec := range []string{"", "GPU-abc", "0,,1", "-1", "0:1"} {
		if parseDeviceSet(spec) != nil {
			t.Fatalf("parse(%q) should be undeterminable", spec)
		}
	}
}

func TestDevicesOverlap(t *testing.T) {
	explicit := func(spec string) resolvedDevices { return resolvedDevices{spec: spec, explicit: true} }
	cases := []struct {
		a, b  resolvedDevices
		over  bool
		reason string
	}{
		{explicit("0"), explicit("1"), false, "disjoint cards must run in parallel"},
		{explicit("0"), explicit("0"), true, "same card collides"},
		{explicit("0,1"), explicit("1"), true, "spec intersection collides"},
		{explicit("0,1"), explicit("2,3"), false, "disjoint multi-card specs pass"},
		{explicit("0"), resolvedDevices{}, true, "undeterminable side blocks"},
		{resolvedDevices{}, resolvedDevices{}, true, "both undeterminable blocks"},
		{explicit("GPU-uuid"), explicit("1"), true, "unparseable spec blocks"},
	}
	for _, c := range cases {
		if got := devicesOverlap(c.a, c.b); got != c.over {
			t.Errorf("devicesOverlap(%+v, %+v) = %v, want %v (%s)", c.a, c.b, got, c.over, c.reason)
		}
	}
}

func TestApplyVisibleDevices(t *testing.T) {
	base := []string{"PATH=/usr/bin", "CUDA_VISIBLE_DEVICES=9"}
	out := applyVisibleDevices(base, "0,1", vendorNvidia)
	want := []string{"PATH=/usr/bin", "CUDA_VISIBLE_DEVICES=0,1"}
	if !reflect.DeepEqual(out, want) {
		t.Fatalf("nvidia inject: %v", out)
	}
	out = applyVisibleDevices([]string{"PATH=/usr/bin", "CUDA_VISIBLE_DEVICES=9"}, "1", vendorAMD)
	want = []string{"PATH=/usr/bin", "HIP_VISIBLE_DEVICES=1", "ROCR_VISIBLE_DEVICES=1"}
	if !reflect.DeepEqual(out, want) {
		t.Fatalf("amd inject: %v", out)
	}
	if out := applyVisibleDevices(base, "", vendorNvidia); !reflect.DeepEqual(out, base) {
		t.Fatalf("empty spec must not touch env: %v", out)
	}
}

func TestResolveVisibleDevices(t *testing.T) {
	l := newLauncher()
	spec := "0,1"
	if r := l.resolveVisibleDevices(&spec); !r.explicit || r.spec != "0,1" {
		t.Fatalf("request body wins: %+v", r)
	}
	empty := ""
	if r := l.resolveVisibleDevices(&empty); r.explicit || r.spec != "" {
		t.Fatalf("explicit empty string means no injection: %+v", r)
	}
	l.card = "2"
	if r := l.resolveVisibleDevices(nil); !r.explicit || r.spec != "2" {
		t.Fatalf("--card applies when the request is silent: %+v", r)
	}
	l.card = ""
	if r := l.resolveVisibleDevices(nil); r.explicit {
		t.Fatalf("silent request without card or env must stay unpinned: %+v", r)
	}
	t.Setenv("CUDA_VISIBLE_DEVICES", "3")
	if r := l.resolveVisibleDevices(nil); r.explicit {
		t.Fatalf("inherited env is not an explicit pin: %+v", r)
	}
	if r := l.resolveVisibleDevices(&spec); !r.explicit || r.spec != "0,1" {
		t.Fatalf("request overrides inherited env: %+v", r)
	}
}

func TestSanitizeDeviceTag(t *testing.T) {
	for in, want := range map[string]string{"0,1": "0-1", "GPU-aa::bb": "GPU-aa--bb", " 0 ": "0", "a b/c": "a-b-c"} {
		if got := sanitizeDeviceTag(in); got != want {
			t.Errorf("sanitizeDeviceTag(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestDeviceTuneCache(t *testing.T) {
	req := startRequest{ModelPath: "/data/models/rwkv7-g1i.pth", StateDBPath: "/state/rwkv_sessions.db"}
	dev := resolvedDevices{spec: "0,1", explicit: true}
	got := deviceTuneCache(req, dev)
	// Mirror the implementation's path resolution so the expectation is
	// portable across OS path separators (and Windows' drive-less IsAbs).
	db := req.StateDBPath
	if !filepath.IsAbs(db) {
		db = filepath.Join(appDir(), db)
	}
	want := filepath.Join(filepath.Dir(db), "rwkv7-g1i.dev-0-1.w8a16.tune")
	if got != want {
		t.Fatalf("deviceTuneCache = %q, want %q", got, want)
	}
	req.EnableDynamicLoading = true
	if got := deviceTuneCache(req, dev); got != "" {
		t.Fatalf("dynamic loading keeps the C++ per-model default: %q", got)
	}
	if got := deviceTuneCache(req, resolvedDevices{}); got != "" {
		t.Fatalf("no devices, no override: %q", got)
	}
}

func TestRuntimeArgsInjectsDeviceTuneCache(t *testing.T) {
	l := newLauncher()
	model := testFile(t, "rwkv7-g1i.pth", "model")
	vocab := testFile(t, "vocab.txt", "vocab")
	req := startRequest{ModelPath: model, VocabPath: vocab, Port: "8000", StateDBPath: "sessions.db"}
	dev := "0,1"
	args, err := l.runtimeArgs(req)
	if err != nil {
		t.Fatal(err)
	}
	if hasTuneCacheArg(args) {
		t.Fatalf("expected no --tune-cache without visible_devices: %v", args)
	}
	req.VisibleDevices = &dev
	args, err = l.runtimeArgs(req)
	if err != nil {
		t.Fatal(err)
	}
	if !hasTuneCacheArg(args) {
		t.Fatalf("expected card-bound --tune-cache with visible_devices: %v", args)
	}
	found := ""
	for i, a := range args {
		if a == "--tune-cache" && i+1 < len(args) {
			found = args[i+1]
		}
	}
	if found == "" || !strings.Contains(found, "dev-0-1.w8a16.tune") {
		t.Fatalf("tune cache not card-bound: %q", found)
	}
}

func hasTuneCacheArg(args []string) bool {
	for _, a := range args {
		if a == "--tune-cache" {
			return true
		}
	}
	return false
}
