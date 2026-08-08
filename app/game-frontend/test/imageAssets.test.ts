import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    configuredGameAssetUrl,
    configuredImagePublicUrl,
    configuredSharedIconPublicUrl,
    configuredUserIconPublicUrl,
    externalizeLegacyImageUrl,
} from '../src/utils/imageAssets.ts';

void describe('imageAssets', () => {
    void it('uses the dedicated image host when no frontend override is provided', () => {
        assert.equal(configuredImagePublicUrl(), 'https://sam-image.hided.net');
        assert.equal(configuredGameAssetUrl(), 'https://sam-image.hided.net/game');
        assert.equal(configuredSharedIconPublicUrl(), 'https://sam-image.hided.net/icons');
        assert.equal(configuredUserIconPublicUrl(), 'https://sam-image.hided.net/icons');
    });

    void it('maps legacy local image paths to the dedicated image host', () => {
        assert.equal(
            externalizeLegacyImageUrl('/image/icons/default.jpg'),
            'https://sam-image.hided.net/icons/default.jpg'
        );
        assert.equal(
            externalizeLegacyImageUrl('/image/general/장수/유비.png'),
            'https://sam-image.hided.net/icons/장수/유비.png'
        );
        assert.equal(externalizeLegacyImageUrl('/gateway/logo.png'), '/gateway/logo.png');
    });
});
