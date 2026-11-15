import { Injectable, Logger, Module, OnApplicationBootstrap } from '@nestjs/common';

@Injectable()
class WorkerLifecycle implements OnApplicationBootstrap {
  private readonly logger = new Logger(WorkerLifecycle.name);

  onApplicationBootstrap(): void {
    this.logger.log('Worker process is ready; queue consumers will be added in the upload phase.');
  }
}

@Module({ providers: [WorkerLifecycle] })
export class WorkerModule {}
