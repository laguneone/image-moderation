import { Controller, Get, Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { ModerationsModule } from './moderations/moderations.module';
import { QueueModule } from './queue/queue.module';
import { StorageModule } from './storage/storage.module';

@Controller()
class AppController {
  @Get('health')
  health(): { status: 'ok'; service: 'api' } {
    return { status: 'ok', service: 'api' };
  }
}

@Module({ imports: [DatabaseModule, QueueModule, StorageModule, ModerationsModule], controllers: [AppController] })
export class AppModule {}
