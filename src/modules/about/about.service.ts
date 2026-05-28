import { Injectable } from '@nestjs/common';
import type { AboutDataDto, AboutResponseDto } from './dto/about-response.dto';

@Injectable()
export class AboutService {
  getAbout(): AboutResponseDto {
    const data: AboutDataDto = {
      project: {
        name: 'Omar Portfolio',
        description: 'A modern, high-performance portfolio built with cutting-edge web technologies.',
        version: '2.1.0',
        status: 'active',
        environment: process.env.NODE_ENV ?? 'development',
        lastUpdated: '2026-05-19T12:00:00Z',
      },
      author: {
        name: 'Omar',
        role: 'Full-Stack Developer',
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
          title: 'Responsive Design',
          description: 'Fully responsive layout that looks great on all devices and screen sizes.',
        },
        {
          title: 'SEO Optimized',
          description: 'Built with best SEO practices to maximize visibility and search engine ranking.',
        },
        {
          title: 'Smooth Animations',
          description: 'Fluid animations and transitions powered by Framer Motion.',
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
        'Add a technical blog with MDX support',
        'Build an admin dashboard for content management',
        'Expand multilingual support with more languages',
      ],
    };

    return { success: true, data };
  }
}
