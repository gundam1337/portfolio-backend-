import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AboutService } from './about.service';
import { AboutResponseDto } from './dto/about-response.dto';

@ApiTags('about')
@Controller('api/about')
export class AboutController {
  constructor(private readonly aboutService: AboutService) {}

  @Get()
  @ApiOkResponse({ type: AboutResponseDto })
  getAbout(): AboutResponseDto {
    return this.aboutService.getAbout();
  }
}
