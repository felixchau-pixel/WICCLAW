# Deployment

## Master
1. Copy `.env.template` to `.env`.
2. Fill the placeholder values only.
3. Install dependencies.
4. Install OpenClaw locally or make the `openclaw` CLI available on `PATH`.
5. Start `scripts/start-vps-master.sh`.

## Mini
1. Copy `device/.env.template` to `device/.env`.
2. Fill the placeholder values only.
3. Copy the `device/` folder to the USB target machine.
4. Install Node 22 and dependencies on the mini machine.
5. Start `device/start-mini.sh`.

## Startup Order
1. Master dependencies and OpenClaw available.
2. Master `.env` filled.
3. Start master.
4. Fill mini `.env`.
5. Start mini.
6. Pair mini from Telegram with `/pair DEVICE_ID`.
