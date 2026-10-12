@echo off
setlocal

REM —— 1. 获取当前日期，格式化为 MM/DD/YYYY ——
for /f "usebackq tokens=1-3 delims=/ " %%a in (`powershell -command "Get-Date -Format 'MM/dd/yyyy'"`) do (
    set "month=%%a"
    set "day=%%b"
    set "year=%%c"
)

REM —— 2. 修改注册表 HKCU\Software\Typora 下的 IDate 值 ——
reg add "HKEY_CURRENT_USER\Software\Typora" /v IDate /t REG_SZ /d "%month%/%day%/%year%" /f

REM —— 3. 启动 Magpie 应用 ——
REM 请根据你的实际安装路径修改下面的路径
start "" "C:\Program Files\Typora\Typora.exe"

endlocal