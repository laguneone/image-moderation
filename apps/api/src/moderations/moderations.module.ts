import { Module } from '@nestjs/common';
import { ApiKeyGuard } from '../common/api-key.guard';
import { ImageValidationService } from './image-validation.service';
import { ModerationsController } from './moderations.controller';
import { ModerationsService } from './moderations.service';

@Module({
  controllers: [ModerationsController],
  providers: [ApiKeyGuard, ImageValidationService, ModerationsService],
})
export class ModerationsModule {}
