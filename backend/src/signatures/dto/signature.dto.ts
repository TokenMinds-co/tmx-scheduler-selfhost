import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateSignatureDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsString()
  html!: string;

  /** Derived from the HTML when blank. */
  @IsOptional()
  @IsString()
  text?: string;
}

export class UpdateSignatureDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  html?: string;

  @IsOptional()
  @IsString()
  text?: string;
}
