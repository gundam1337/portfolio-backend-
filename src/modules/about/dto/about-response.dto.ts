import { ApiProperty } from '@nestjs/swagger';

export class ProjectInfoDto {
  @ApiProperty() name!: string;
  @ApiProperty() description!: string;
  @ApiProperty() version!: string;
  @ApiProperty() status!: string;
  @ApiProperty() environment!: string;
  @ApiProperty() lastUpdated!: string;
}

export class AuthorInfoDto {
  @ApiProperty() name!: string;
  @ApiProperty() role!: string;
  @ApiProperty() website!: string;
  @ApiProperty() github!: string;
}

export class StackInfoDto {
  @ApiProperty({ type: [String] }) frontend!: string[];
  @ApiProperty({ type: [String] }) backend!: string[];
  @ApiProperty({ type: [String] }) infrastructure!: string[];
}

export class FeatureDto {
  @ApiProperty() title!: string;
  @ApiProperty() description!: string;
}

export class LighthouseScoresDto {
  @ApiProperty() performance!: number;
  @ApiProperty() accessibility!: number;
  @ApiProperty() bestPractices!: number;
  @ApiProperty() seo!: number;
}

export class PerformanceInfoDto {
  @ApiProperty({ type: LighthouseScoresDto }) lighthouse!: LighthouseScoresDto;
}

export class StatsInfoDto {
  @ApiProperty() components!: number;
  @ApiProperty() pages!: number;
  @ApiProperty() deployments!: number;
}

export class LinksInfoDto {
  @ApiProperty() live!: string;
  @ApiProperty() repository!: string;
}

export class AboutDataDto {
  @ApiProperty({ type: ProjectInfoDto }) project!: ProjectInfoDto;
  @ApiProperty({ type: AuthorInfoDto }) author!: AuthorInfoDto;
  @ApiProperty({ type: StackInfoDto }) stack!: StackInfoDto;
  @ApiProperty({ type: [FeatureDto] }) features!: FeatureDto[];
  @ApiProperty({ type: PerformanceInfoDto }) performance!: PerformanceInfoDto;
  @ApiProperty({ type: StatsInfoDto }) stats!: StatsInfoDto;
  @ApiProperty({ type: LinksInfoDto }) links!: LinksInfoDto;
  @ApiProperty({ type: [String] }) futurePlans!: string[];
}

export class AboutResponseDto {
  @ApiProperty({ example: true }) success!: true;
  @ApiProperty({ type: AboutDataDto }) data!: AboutDataDto;
}
