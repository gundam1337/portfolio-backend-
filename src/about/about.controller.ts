import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { I18nLang } from 'nestjs-i18n';
import { AboutService } from './about.service';
import type { AboutResponse } from './about.types';

@ApiTags('about')
@Controller('api/about')
export class AboutController {
  constructor(private readonly aboutService: AboutService) {}

  @Get()
  @ApiQuery({
    name: 'lang',
    required: false,
    enum: ['en', 'fr'],
    description: 'Response language (defaults to en)',
  })
  @ApiOkResponse({ description: 'Portfolio information' })
  getAbout(@I18nLang() lang: string): Promise<AboutResponse> {
    return this.aboutService.getAbout(lang);
  }
}
