import { Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';

const LOKI_URL = process.env.LOKI_URL ?? 'http://localhost:3100';

@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      useFactory: () => {
        const transport = {
              targets: [
                {
                  target: 'pino-pretty',
                  level: 'debug',
                  options: { colorize: true, singleLine: true },
                },
                {
                  target: 'pino-loki',
                  level: 'debug',
                  options: {
                    host: LOKI_URL,
                    labels: { app: 'nestjs-portfolio', env: 'development' },
                    // Batch up to 10 log lines or flush every second, whichever comes first.
                    // Keeps HTTP overhead low without delaying visibility in Grafana.
                    batching: true,
                    interval: 1,
                  },
                },
              ],
            };

        return {
          pinoHttp: {
            level: 'debug',
            transport,
            customProps: (req: import('http').IncomingMessage & { id?: string }) => ({
              requestId: req.id,
            }),
            autoLogging: true,
            serializers: {
              req: (req: Record<string, unknown>) => ({
                id: req['id'],
                method: req['method'],
                url: req['url'],
              }),
            },
          },
        };
      },
    }),
  ],
  exports: [PinoLoggerModule],
})
export class LoggerModule {}
