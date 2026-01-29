import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import * as streamifier from 'streamifier';

@Injectable()
export class CloudinaryService {
  constructor(private configService: ConfigService) {
    cloudinary.config({
      cloud_name: this.configService.get<string>('CLOUDINARY_CLOUD_NAME'),
      api_key: this.configService.get<string>('CLOUDINARY_API_KEY'),
      api_secret: this.configService.get<string>('CLOUDINARY_API_SECRET'),
    });
  }

  async uploadCertificate(file: Express.Multer.File): Promise<string> {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: 'mechanic-certificates',
          resource_type: 'raw',
        },
        (error, result) => {
          if (error) return reject(error);
          if (!result?.secure_url) return reject(new Error('Upload failed'));
          resolve(result.secure_url);
        },
      );
      streamifier.createReadStream(file.buffer).pipe(stream);
    });
  }

  async uploadImage(file: Express.Multer.File, folder: string = 'mechanic-documents'): Promise<string> {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder, resource_type: 'image' },
        (error, result) => {
          if (error) return reject(error);
          if (!result?.secure_url) return reject(new Error('Upload failed'));
          resolve(result.secure_url);
        },
      );
      streamifier.createReadStream(file.buffer).pipe(stream);
    });
  }

  async uploadFile(file: Express.Multer.File, folder: string = 'mechanic-certificates'): Promise<string> {
    const isPdf = file.mimetype === 'application/pdf';
    if (isPdf) return this.uploadCertificate(file);
    return this.uploadImage(file, folder);
  }
}
