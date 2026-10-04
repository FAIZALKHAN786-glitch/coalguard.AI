import "dotenv/config";
import { createApp } from "./app.js";
const { app, db } = createApp();
const server = app.listen(Number(process.env.PORT) || 3001, "0.0.0.0", () =>
  console.log(`CoalGuard API listening on 0.0.0.0:${process.env.PORT || 3001}`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(() => {
      db.close();
      process.exit(0);
    }),
  );
