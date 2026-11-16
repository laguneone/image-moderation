import { Module } from '@nestjs/common';
import { ApiKeyGuard } from '../common/api-key.guard';
import { AdminController } from './admin.controller';
import { ImageValidationService } from './image-validation.service';
import { ModerationsController } from './moderations.controller';
import { ModerationsService } from './moderations.service';

@Module({
  controllers: [ModerationsController, AdminController],
  providers: [ApiKeyGuard, ImageValidationService, ModerationsService],
})
export class ModerationsModule {}
