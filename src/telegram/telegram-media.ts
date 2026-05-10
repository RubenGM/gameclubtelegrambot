export type TelegramPhotoMediaSource = string | { filePath: string };

export type TelegramPhotoMediaInput = {
  type: 'photo';
  media: TelegramPhotoMediaSource;
  caption?: string;
};
