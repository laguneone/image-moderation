import { Module } from '@nestjs/common';
import { ApiKeyGuard } from '../common/api-key.guard';
import { AdminController } from './admin.controller';
import { ConfigurationController } from './configuration.controller';
import { AnalyticsController } from './analytics.controller';
import { AdminSessionGuard } from '../common/admin-session.guard';
import { ImageValidationService } from './image-validation.service';
import { ModerationsController } from './moderations.controller';
import { ModerationsService } from './moderations.service';

@Module({
  controllers: [ModerationsController, AdminController, ConfigurationController, AnalyticsController],
  providers: [ApiKeyGuard, AdminSessionGuard, ImageValidationService, ModerationsService],
})
export class ModerationsModule {}
