"""
launch_test.py - dsh-rules（rulebase）项目专用测试 DSH 启动器。
从 allMemory 项目复制适配（路径由 __file__ 自动解析，无需改动）。

从被污染的 DSH 会话终端中启动干净的测试 DSH。
通过 subprocess.Popen + 精准 env 控制子进程环境块：
- 只传 DSH_HOME + 必要的系统变量（PATH/USERPROFILE/SYSTEMROOT）
- 不传 DSH_SESSION_ID / DSH_SHELL / DSH_WEB_URL / DSH_AGENTS_HOME
- 子进程在独立的新控制台启动，与主 dsh 进程完全隔离

DSH_HOME 指向项目内预配置的 tests\\.dsh（仅含官方 bundle + LLM 端点，无额外插件）。
该目录已预配置、可直接使用，启动器不作校验。

用法（pwsh / cmd 均可）：
    python scripts\\launch_test.py             默认端口 8631
    python scripts\\launch_test.py <port>      指定端口
    python scripts\\launch_test.py plugin <args...>
                                              e.g.  plugin add .
                                                    plugin remove rulebase
"""

import subprocess
import sys
import os

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEST_DSH_HOME = os.path.join(REPO, 'tests', '.dsh')
DEFAULT_PORT = 8641


def make_clean_env():
    """构建干净的环境块 - 只含必要系统变量 + DSH_HOME"""
    safe_vars = [
        'PATH', 'USERPROFILE', 'SYSTEMROOT', 'APPDATA',
        'ComSpec', 'WINDIR', 'TEMP', 'TMP',
        'NUMBER_OF_PROCESSORS', 'OS', 'PROCESSOR_ARCHITECTURE',
        'SystemDrive',
    ]
    env = {}
    for v in safe_vars:
        val = os.environ.get(v)
        if val:
            env[v] = val
    env['DSH_HOME'] = TEST_DSH_HOME
    return env


def start_dsh(port: int):
    """在新控制台启动测试 DSH web 实例"""
    env = make_clean_env()
    cmd = f'dsh --profile web --port {port}'
    print(f'[launch_test] DSH_HOME = {TEST_DSH_HOME}')
    print(f'[launch_test] 启动: {cmd}')
    print(f'[launch_test] 新 cmd 窗口已打开，按 Ctrl+C 停止 DSH')
    print(f'[launch_test] 浏览器: http://127.0.0.1:{port}')
    print()

    subprocess.Popen(
        cmd,
        env=env,
        cwd=REPO,
        shell=True,
        creationflags=subprocess.CREATE_NEW_CONSOLE,
    )


def run_plugin(args: list):
    """转发到 dsh plugin --profile web <args>，输出到当前终端"""
    env = make_clean_env()
    cmd = f'dsh plugin --profile web {" ".join(args)}'
    print(f'[launch_test] DSH_HOME = {TEST_DSH_HOME}')
    print(f'[launch_test] 转发: {cmd}')
    print()

    proc = subprocess.Popen(
        cmd,
        env=env,
        cwd=REPO,
        shell=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    out, err = proc.communicate(timeout=120)
    if out:
        sys.stdout.buffer.write(out)
    if err:
        sys.stderr.buffer.write(err)
    sys.exit(proc.returncode)


if __name__ == '__main__':
    if len(sys.argv) >= 2 and sys.argv[1] == 'plugin':
        run_plugin(sys.argv[2:])
    elif len(sys.argv) >= 2:
        try:
            port = int(sys.argv[1])
        except ValueError:
            print(f'[launch_test] 错误：无法解析端口号 "{sys.argv[1]}"')
            sys.exit(1)
        start_dsh(port)
    else:
        start_dsh(DEFAULT_PORT)