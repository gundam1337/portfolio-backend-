import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { I18nLang } from 'nestjs-i18n';
import { AboutService } from './about.service';
import { AboutResponseDto } from './dto/about-response.dto';

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
  @ApiOkResponse({ type: AboutResponseDto })
  getAbout(@I18nLang() lang: string): Promise<AboutResponseDto> {
    return this.aboutService.getAbout(lang);
  }
}
