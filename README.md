# issabel

Módulo do pvx com as ferramentas do Issabel. A aba **Issabel** é o índice delas: hoje só o `netinstall`; "backups" e "saúde" aparecem como "em breve". O `netinstall` instala o Issabel 5 do zero no Rocky Linux 8, em segundo plano.

## Ficha de módulo

1. **Responsabilidade:** instalar o Issabel 5 numa central Rocky/RHEL 8+ (repositórios, preparo, PHP 7.4 Remi, pacotes, banco, painel do operador, fuso, senhas, reinício), acompanhar a instalação ao vivo e continuar de onde parou.
2. **Não faz:** não instala em outro sistema, não restaura backup, não configura firewall (use `pvx firewall` depois), não guarda senha fora do arquivo de credenciais.
3. **Comandos:**
   - `issabel netinstall [--astver 16|18] [--addpkgs licensed|community-blocklist|wanpipe|none]... [--timezone Area/Cidade] [--force] [--skip-clean] [--no-reboot] [--follow]` (destrutivo, exige `--yes`): verifica, inicia o job e, com `--follow`, segue o log. Senhas: `PVX_SECRET_SQL_PASSWORD` e `PVX_SECRET_WEB_PASSWORD` (ou `--sql-password-stdin`); vazias, são geradas (24 letras e dígitos).
   - `issabel netinstall run`: corpo interno do job.
   - `issabel netinstall status` (somente leitura), `stop` (destrutivo), `resume [--follow]`, `check [--force]` (somente leitura).
   - `issabel netinstall reboot` (destrutivo) e `postpone`: respondem à contagem do reinício.
   - Aba **Issabel**: hub, verificação, perguntas (Asterisk e senhas), confirmação editável, instalação ao vivo, falha com "continuar daqui" e tela final.
4. **Capacidades e consultas:** capacidade `issabel.installed` (opt-in; conserta com `issabel netinstall`). Consultas: `issabel.check`, `issabel.central`, `issabel.progress`, `issabel.credentials`.
5. **Estado que grava:** no `state.json`: `progress` (fases, pacotes, erro; sem segredos) e `reboot`. Em `$PVX_HOME/modules/issabel/state/`: `credenciais-<data>.txt` (0600, escrito por arquivo temporário e `mv`). Jobs em `jobs/netinstall.*`.
6. **Permissões:** `exec`: ver `pvx-module.json` (dnf, rpm, curl, systemctl, setenforce, groupadd, useradd, sysctl, mysql, sqlite3, timedatectl, hwclock, ln, rm, mkdir, chown, chmod, cp, mv, amportal, issabel-admin-passwords, create_fop2_manager_user.pl, install_amp, firewall-cmd, reboot, hostname, asterisk); um teste confere que a lista é exata. `fs`: leitura de `/etc/os-release`, `/etc/issabel.conf`, `/etc/passwd`, `/proc/meminfo`, `/usr/local/fop2/`; escrita em `/etc/sysctl.conf`, `/etc/selinux/config`, `/etc/php.ini` e no diretório de estado. Nenhuma rede (o `curl` testa o mirror).
7. **Depende de (`uses`):** nenhum módulo.

## Como funciona

Fases (`src/phases/`): repositórios, preparo, PHP (Remi), pacotes (lote, depois pacote a pacote), pós-instalação, banco, painel do operador, fuso, senhas, reinício. O progresso vai para o store; `resume` pula as fases concluídas e lê as senhas do arquivo de credenciais. A única ferramenta que recebe senha em argv é `issabel-admin-passwords`; o comando aparece mascarado nos logs.

## Estrutura

Segue o modelo do `pvx-firewall`: `src/index.tsx` só liga as peças; `src/commands/<assunto>.ts` (start, run, status, control); `src/health/{prove,queries,summary}.ts`; `src/state.ts` (tipos persistidos e `STORE_KEY`); `src/texts.ts`; `src/exec.ts` (shell sobre `ctx.exec`); `src/phases/` (uma fase por arquivo); `src/page/` (um componente por arquivo, mais `layout.ts`, `rows.ts`, `outcome.ts` puros).

## Desenvolvimento

Os testes usam o host do pvx clonado ao lado, em `../pvx-opentui` (`tsconfig.json` e `bunfig.toml`). Nenhum teste toca o sistema: o módulo aceita uma máquina falsa (`src/system.ts`) e o job dos testes roda contra ela (`test/fixture`).

```sh
bun test
../pvx-opentui/node_modules/.bin/tsc --noEmit --noUnusedLocals
```
