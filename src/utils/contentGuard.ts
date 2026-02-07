
// Simple content guard for profanity and political keywords
const PROFANITY_KEYWORDS = [
    '脏话', 'sb', '操', '傻逼', '他妈的', '畜生', '垃圾', '废物', '死全家', '滚蛋',
    'fuck', 'shit', 'bitch', 'asshole', 'bastard', 'dick', 'pussy'
]; 
const POLITICAL_KEYWORDS = [
    '习近平', '李强', '毛泽东', '特朗普', '拜登', '普京', '金正恩', '达赖', '法轮功', '六四', '天安门事件',
    'Xi Jinping', 'Joe Biden', 'Donald Trump', 'Vladimir Putin', 'Kim Jong Un', 'Dalai Lama'
]; 

export function checkContentSafety(text: string): { safe: boolean; reason?: string } {
    if (!text) return { safe: true };

    const lowerText = text.toLowerCase();

    for (const word of PROFANITY_KEYWORDS) {
        if (lowerText.includes(word.toLowerCase())) {
            return { safe: false, reason: '包含敏感词汇' };
        }
    }

    for (const word of POLITICAL_KEYWORDS) {
        if (lowerText.includes(word.toLowerCase())) {
            return { safe: false, reason: '包含敏感政治人物名称' };
        }
    }

    return { safe: true };
}
