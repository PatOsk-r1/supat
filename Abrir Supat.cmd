@echo off
REM Abre Supat en el navegador. Cerrá esta ventana para apagarla.
cd /d "%~dp0"
where node >nul 2>nul || (echo Falta Node.js. Instalalo gratis desde https://nodejs.org y volve a intentar. & pause & exit /b 1)
if not exist node_modules (
  echo Instalando dependencias por primera vez...
  call npm.cmd install || (pause & exit /b 1)
)
echo Abriendo Supat... Para apagarla, cerra esta ventana.
call npm.cmd run dev -- --open
pause
