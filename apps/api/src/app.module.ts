import { Controller, Get, Module } from '@nestjs/common';

@Controller()
class AppController {
  @Get('health')
  health(): { status: 'ok'; service: 'api' } {
    return { status: 'ok', service: 'api' };
  }
}

@Module({ controllers: [AppController] })
export class AppModule {}
