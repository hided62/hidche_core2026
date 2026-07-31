import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    DEFAULT_GENERAL_ICON_URL,
    resolveGeneralIconBackgroundImage,
    resolveGeneralIconUrl,
    resolveMessageGeneralIconUrl,
} from '../src/utils/generalIcon.ts';

void describe('generalIcon', () => {
    void it('routes user icons through the gateway and encodes the complete filename', () => {
        assert.equal(
            resolveGeneralIconUrl(
                { picture: '계정 icon/../1.jpg', imageServer: 1 },
                { userIconBaseUrl: '/gateway/api/user-icons/' }
            ),
            '/gateway/api/user-icons/%EA%B3%84%EC%A0%95%20icon%2F..%2F1.jpg'
        );
    });

    void it('preserves each view legacy base for non-user icons', () => {
        assert.equal(
            resolveGeneralIconUrl({ picture: '22.jpg', imageServer: 0 }, { legacyBaseUrl: '/image/general/' }),
            '/image/general/22.jpg'
        );
        assert.equal(
            resolveGeneralIconUrl({ picture: '22.jpg', imageServer: 0 }, { legacyBaseUrl: '/image/game' }),
            '/image/game/22.jpg'
        );
        assert.equal(
            resolveGeneralIconUrl({ picture: '장수/관우 1.png', imageServer: 0 }),
            '/image/icons/%EC%9E%A5%EC%88%98/%EA%B4%80%EC%9A%B0%201.png'
        );
        assert.equal(
            resolveGeneralIconUrl({ picture: '../secret.png', imageServer: 0 }),
            '/image/icons/%2E%2E/secret.png'
        );
    });

    void it('uses a deterministic default and safe layered fallback for CSS backgrounds', () => {
        assert.equal(resolveGeneralIconUrl({ picture: null, imageServer: 0 }), '/image/icons/default.jpg');
        assert.equal(
            resolveGeneralIconBackgroundImage(
                { picture: 'custom.jpg', imageServer: 1 },
                { userIconBaseUrl: '/gateway/api/user-icons' }
            ),
            'url("/gateway/api/user-icons/custom.jpg"), url("/image/icons/default.jpg")'
        );
    });

    void it('translates legacy message d_pic references without changing absolute or external icons', () => {
        assert.equal(
            resolveMessageGeneralIconUrl('d_pic/user name.jpg', '/gateway/api/user-icons/'),
            '/gateway/api/user-icons/user%20name.jpg'
        );
        assert.equal(resolveMessageGeneralIconUrl('/image/icons/22.jpg'), '/image/icons/22.jpg');
        assert.equal(resolveMessageGeneralIconUrl('https://cdn.example/icon.jpg'), 'https://cdn.example/icon.jpg');
        assert.equal(resolveMessageGeneralIconUrl(''), DEFAULT_GENERAL_ICON_URL);
    });
});
