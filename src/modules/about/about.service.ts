import { Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import type { AboutDataDto, AboutResponseDto } from './dto/about-response.dto';

@Injectable()
export class AboutService {
  constructor(private readonly i18n: I18nService) {}

  async getAbout(lang: string): Promise<AboutResponseDto> {
    const t = (key: string) => this.i18n.t(`about.${key}`, { lang });

    const data: AboutDataDto = {
      project: {
        name: 'Omar Portfolio',
        description: await t('project.description'),
        version: '2.1.0',
        status: 'active',
        environment: process.env.NODE_ENV ?? 'development',
        lastUpdated: '2026-05-19T12:00:00Z',
      },
      author: {
        name: 'Omar',
        role: await t('author.role'),
        website: 'https://your-domain.com',
        github: 'https://github.com/your-username',
      },
      stack: {
        frontend: ['React', 'Next.js', 'TypeScript', 'Tailwind CSS', 'Framer Motion'],
        backend: ['Node.js', 'Next.js Server Actions'],
        infrastructure: ['Vercel', 'Resend'],
      },
      features: [
        {
          title: await t('features.responsiveDesign.title'),
          description: await t('features.responsiveDesign.description'),
        },
        {
          title: await t('features.seoOptimized.title'),
          description: await t('features.seoOptimized.description'),
        },
        {
          title: await t('features.animations.title'),
          description: await t('features.animations.description'),
        },
      ],
      performance: {
        lighthouse: {
          performance: 98,
          accessibility: 100,
          bestPractices: 100,
          seo: 100,
        },
      },
      stats: {
        components: 42,
        pages: 12,
        deployments: 84,
      },
      links: {
        live: 'https://your-domain.com',
        repository: 'https://github.com/your-username/portfolio',
      },
      futurePlans: [
        await t('futurePlans.blog'),
        await t('futurePlans.adminDashboard'),
        await t('futurePlans.multilingualSupport'),
      ],
    };

    return { success: true, data };
  }
}
