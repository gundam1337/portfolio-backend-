import { Global, Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';

const LOKI_URL = process.env.LOKI_URL ?? 'http://localhost:3100';
const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info';

@Global()
@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      useFactory: () => {
        const transport = {
          targets: [
            {
              target: 'pino-pretty',
              level: LOG_LEVEL,
              options: { colorize: true, singleLine: true },
            },
            {
              target: 'pino-loki',
              level: LOG_LEVEL,
              options: {
                host: LOKI_URL,
                labels: { app: 'nestjs-portfolio', env: 'development' },
                labelKeys: ['level', 'context'],
                batching: false,
                silenceErrors: true,
              },
            },
          ],
        };

        return {
          pinoHttp: {
            level: LOG_LEVEL,
            transport,
            customProps: (req: import('http').IncomingMessage & { id?: string }) => ({
              requestId: req.id,
            }),
            autoLogging: false,
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
