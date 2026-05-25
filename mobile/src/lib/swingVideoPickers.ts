import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import type { UploadVideoInput } from "./api";

export async function pickSwingVideoFromPhotos(): Promise<UploadVideoInput | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    throw new Error(
      "Photo library access denied. Enable Photos access in Settings to pick swing clips."
    );
  }

  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["videos"],
    allowsMultipleSelection: false,
    videoQuality: 1,
  });

  if (res.canceled || !res.assets[0]) return null;

  const asset = res.assets[0];
  return {
    uri: asset.uri,
    name: asset.fileName ?? undefined,
    size: asset.fileSize,
    mimeType: asset.mimeType,
  };
}

export async function pickSwingVideoFromFiles(): Promise<UploadVideoInput | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: "video/*",
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (result.canceled || result.assets.length === 0) return null;

  const asset = result.assets[0]!;
  return {
    uri: asset.uri,
    name: asset.name,
    size: asset.size,
    mimeType: asset.mimeType ?? undefined,
  };
}
