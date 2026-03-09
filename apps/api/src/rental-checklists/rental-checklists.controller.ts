import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { RentalChecklistsService } from './rental-checklists.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { AssignChecklistDto } from './dto/assign-checklist.dto';
import { CheckItemDto } from './dto/check-item.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('rental-checklists')
export class RentalChecklistsController {
  constructor(
    private readonly rentalChecklistsService: RentalChecklistsService,
  ) {}

  @Get('templates')
  getTemplates() {
    return this.rentalChecklistsService.getTemplates();
  }

  @Post('templates')
  createTemplate(@Body() dto: CreateTemplateDto) {
    return this.rentalChecklistsService.createTemplate(dto);
  }

  @Get('templates/:id')
  getTemplate(@Param('id') id: string) {
    return this.rentalChecklistsService.getTemplate(id);
  }

  @Put('templates/:id')
  updateTemplate(@Param('id') id: string, @Body() dto: UpdateTemplateDto) {
    return this.rentalChecklistsService.updateTemplate(id, dto);
  }

  @Delete('templates/:id')
  deleteTemplate(@Param('id') id: string) {
    return this.rentalChecklistsService.deleteTemplate(id);
  }

  @Post('assign')
  assignToRental(@Body() dto: AssignChecklistDto) {
    return this.rentalChecklistsService.assignToRental(
      dto.rentalOrderId,
      dto.templateId,
    );
  }

  @Get('rental/:rentalOrderId')
  getRentalChecklist(@Param('rentalOrderId') rentalOrderId: string) {
    return this.rentalChecklistsService.getRentalChecklist(rentalOrderId);
  }

  @Patch('entries/:entryId/check')
  checkItem(
    @Param('entryId') entryId: string,
    @CurrentUser('id') adminUserId: string,
    @Body() dto: CheckItemDto,
  ) {
    return this.rentalChecklistsService.checkItem(
      entryId,
      adminUserId,
      dto.notes,
    );
  }

  @Patch('entries/:entryId/uncheck')
  uncheckItem(@Param('entryId') entryId: string) {
    return this.rentalChecklistsService.uncheckItem(entryId);
  }
}
