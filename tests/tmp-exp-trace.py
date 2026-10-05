#!/usr/bin/env python3
"""体验探针：解压 tests 实例会话轨迹，验证 system/message 中规则库边界标记。"""
import sys, json, os

try:
    import zstandard as zstd
except ImportError:
    print("ERROR: zstandard not installed"); sys.exit(2)

trace_path = sys.argv[1] if len(sys.argv) > 1 else r"O:\mcpFs\dsh-plugin-build\dsh-rules\tests\.dsh\sessions\--O-mcpFs-dsh-plugin-build-dsh-rules--\session-f75e3656-9631-405b-a3f6-0173f7f6637b\session.v4.jsonl.zstd"

with open(trace_path, 'rb') as f:
    raw = zstd.ZstdDecompressor().stream_reader(f, read_across_frames=True).read()
text = raw.decode('utf-8', errors='replace')

BEGIN = '［规则库开始］'
END = '［规则库结束］'
EMPTY = '（当前无全局规则与项目规则）'

sysmsg = None
for line in text.splitlines():
    line = line.strip()
    if not line:
        continue
    try:
        obj = json.loads(line)
    except Exception:
        continue
    if obj.get('type') == 'system/message':
        try:
            sysmsg = obj['data']['message']['content'][0]['text']
        except Exception:
            sysmsg = None

if sysmsg is None:
    print("NO system/message found in trajectory"); sys.exit(1)

print(f"system/message length: {len(sysmsg)} chars")
print(f"contains BEGIN: {BEGIN in sysmsg}")
print(f"contains END: {END in sysmsg}")
print(f"contains EMPTY-placeholder: {EMPTY in sysmsg}")
print(f"contains '### 全局规则': {'### 全局规则' in sysmsg}")
print(f"contains '### 项目规则': {'### 项目规则' in sysmsg}")

pos_begin = sysmsg.find(BEGIN)
pos_end = sysmsg.find(END)
print(f"pos BEGIN: {pos_begin}")
print(f"pos END: {pos_end}")
print(f"BEGIN before END: {pos_begin < pos_end}")

if pos_end >= 0:
    after = sysmsg[pos_end+len(END):pos_end+len(END)+150]
    print(f"--- 150 chars AFTER END ---")
    print(repr(after))

if pos_begin >= 0 and pos_end >= 0:
    segment = sysmsg[pos_begin:pos_end+len(END)]
    print(f"--- RULES SEGMENT length: {len(segment)} chars ---")
    # print last 200 chars of segment
    print("SEGMENT TAIL 200:")
    print(repr(segment[-200:]))
    # print first 80 chars
    print("SEGMENT HEAD 80:")
    print(repr(segment[:80]))
