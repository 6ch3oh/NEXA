import { deepFreeze } from '../domain/shared.mjs';
import { createMultipleChoiceContent } from '../content/question-answer-content.mjs';
import { createStudyCollection, StudyCollectionType } from '../study/study-collection.mjs';
import { calculateStudyContentDigest, createStudyContentPackageManifest } from './study-content-package-contract.mjs';
import { GenericStudySourceClassification } from './generic-study-content-importer.mjs';

export const DRIVING_THEORY_USER_PDF_PILOT_VERSION = '0.1';
export const DRIVING_THEORY_USER_PDF_COLLECTION_ID = 'driving-theory-user-pdf-pilot';
export const DRIVING_THEORY_USER_PDF_SOURCE_ID = 'user-pdf:3409364b3f56';
export const DRIVING_THEORY_USER_PDF_SHA256 = '3409364b3f56ade44ce8940ade9cc15cccb7035e7eac5cef668c1de3ac83def9';
export const DRIVING_THEORY_USER_PDF_TIMESTAMP = '2026-08-22T00:00:00.000Z';

const PAGE_HASHES = Object.freeze({
  2:'684ff6edcc2b0282bfaefb4f6d048daabbd6b144e6c8a04e3f4946c13f903973', 3:'8419a926d8ac3faa6b70c708073be78c879dfb7db70788580d134c4312b10783',
  5:'a9eb8d60c6cb6653927b0fc182dc0b3a2448f4a79170ca120efcdb6996703203', 7:'3c823aec04423e414caeca0ac25bbbc819f4238873cc740d7b5dbeed3a1902b8',
  12:'ff65c9a061d6ed7fc76a3913cae51feb7f1ef5512da6b670b5ebf99ad8ab0a85', 15:'732b8de1fcf4b57bbf78679c923efa9cb179787d5ac8d5c4b0dd0cc013e56be2',
  16:'9312c607d1e60874bfaf4bb54251a9043d84820c86ccf5cc162213ff46d57107', 18:'a322546877aeef0763db323b2decbdeaab6a5c6bc65abcab0c1123ba66dac55c',
  24:'eaac86796ec1f0aaed954352bfeaabb31402e2ea0c4477c1a219c4698102ae53', 31:'0e35797516866195f53791b8e4047cc9e7860df9deb69303961d69b413a2e104',
  38:'8e5b1ed07cd057d358d3141be594d945781e1b96130e21cb6593e59b91f762ee', 46:'725cdbdab30bd7bc5c3fc0aaa75e112737f852e74812c6ef0c7d8a302116a2d3',
  49:'c0130fad8c8671198d8456e2e39b31e2102dea6ca0ff46d31674b3a0a1bb6ed1', 64:'dd2c962d277df65f14af8e862cde06bf2ad900eb2eac826eab3570d6b078805a',
  66:'2b16d08e4ccc0dd627041d8e537a0171f68ab263c4c2950fc9ad3a688c34ee72', 71:'4022b207f76f330edd8f99ce5f5343af945aaa2314ba4cceb96b9d8e9f2aa4a2',
  83:'93b368d836aca310cbe609ee2842931a0c6e82fd45757f1c18dc1b5999f2aa99', 116:'a8fefb7fae28a0d970da1cca63140ad32820d730633e10e0604633ae721bbac6',
  123:'34d75d7967cc0afc328e2557d3b06c195e0ff258b5c01ec65ba7a1508be27025', 139:'3424cf28b2e445e32783c6b714b202f0e7e8bae16a1f9ee183e779780ae324fb',
});

const MEDIA = Object.freeze({
  5: media(5, [500,300,1380,1420], '77151c6d8d6bbc05aaffc106b94819d61a5d2ab2e6bde03be4e4b34273f2f84c'),
  7: media(7, [300,300,1780,1120], 'e2bf3c6f7376e6c2437e3b66b9ad69b306303a2b066dee3cada73fa1bb02a8f8'),
  12: media(12, [300,350,1780,1300], '7a3d1446b8280492ff41db20fde63359b0a5e2e235464399357e5218ce079e60'),
  15: media(15, [450,250,1500,1420], 'ea5e224b6a1dc1ee6fe53fc54202d24ef22de6b984378ae2c4fdce3d628f528f'),
  16: media(16, [450,250,1500,1420], 'f9516fd43a2423a450760a32532b3da77ae0193223a2ebf45b3ac2f1bec53a61'),
  18: media(18, [450,250,1500,1420], '92d40980952bf7d9bfa8bfb2ba055ff70a3171847704f9bba72c2a35b4865492'),
  24: media(24, [450,250,1500,1420], '651f7f163eaf8fb09693b76338830747d0065e02371ec075599b55488ee06e11'),
  31: media(31, [450,250,1500,1420], '97cbff5914977fc763b4055b533b6c0c4f60761cb155d7ba5cfb33ca98d20dd0'),
  38: media(38, [350,250,1680,1430], 'd02f413bf006550606255e9f6cd9f35e44744940a407ad0a88796a7a292c9ea2'),
  46: media(46, [550,330,1280,1360], 'f36437d1bec4ee96a557059bd7d2dc3f906d67d7b8ee13f6259b17d918bf5817'),
  49: media(49, [420,260,1540,1370], 'b64cf6fbe5a567d2196cfd3134f7ac7aa14de652f4eeeb75ec617aa0050d88e4'),
  64: media(64, [470,250,1460,1400], '9adf68750d5ed8560bd0a4934591a7168b8e5c4723bf4d79aa078f0b37ff4712'),
  66: media(66, [470,250,1460,1400], '33b977cf84f66d018126708da0b0d3764576ee394e8669253123f18283115247'),
  116: media(116, [580,240,1280,1420], '97355b4acbd71e80e09e96b921f7b89d89a66b3d6a1bf9aa9d0963c6ed805f5a'),
  123: media(123, [630,350,1160,1420], '7186e248c43da6e70be2ffdfc92b69f8ef9efae9f9129612600f6bad42949de4'),
  139: media(139, [430,230,1540,1500], '7815ac62d47f66c90c8864d300361ebdbe6e9e44734a20737199e31381a93a00'),
});

const RAW = [
  q(2, 'MC', '驾驶人违反交通运输管理法规发生重大事故使公私财产遭受重大损失，可能会受到什么刑罚？', ['处5年以上徒刑','处3年以下徒刑或者拘役','处3年以上徒刑','处3年以上7年以下徒刑'], 1, '关键字答题：选项中看到拘役，直接选'),
  q(3, 'TRUE_FALSE', '驾驶校车、公路客运汽车、旅游客运汽车、7座以上载客汽车以外的其他载客汽车载人超过核定人数百分之五十以上未达到百分之百的，一次记9分。', ['正确','错误'], 1, '关键字答题：校车、公路客运、旅游客运汽车超载未达20%/7座以上载客汽车超员20%-50%/其他载客汽车超员50%-100%，记6分'),
  q(5, 'MC', '图中圈内的锯齿状白色实线是什么标线？', ['导向车道线','方向引导线','可变导向车道线','单向行驶线'], 2, '秒懂技巧：图中有锯齿代表可变车道'),
  q(7, 'TRUE_FALSE', '驾驶机动车在这种信号灯亮的路口，可以右转弯。', ['正确','错误'], 0, '秒懂技巧：圆形红/绿/黄灯不影响右转弯，不影响直行的人和车时，可以右转'),
  q(12, 'MC', '下面哪个信号灯闪烁表示前方路口或道路是危险路段？', ['图①','图②','图③','图④'], 0, '秒懂技巧：一个框的黄灯不断闪烁就是前方危险，提醒注意安全'),
  q(15, 'MC', '这属于哪一种标志？', ['警告标志','指路标志','指示标志','禁令标志'], 0, '秒懂技巧：黄色是警告标志，蓝色是指示标识，红色是禁令标志'),
  q(16, 'MC', '这是什么交通标志？', ['易滑路段','急转弯路','反向弯路','连续弯路'], 2, '速记口诀：弯路标志1急2反3连续。1个弯是急转弯，朝左为向左急转弯，朝右为向右急转弯；2个弯是反向弯路；3个弯是连续转弯'),
  q(18, 'MC', '这个标志是何含义？', ['堤坝路','上陡坡','连续上坡','下陡坡'], 1, '秒懂技巧：箭头向上上坡，箭头向下下坡，2个箭头连续'),
  q(24, 'MC', '这个标志是何含义？', ['双向交通','分离式道路','潮汐车道','减速让行'], 0, '秒懂技巧：上下箭头，选双向'),
  q(31, 'MC', '这个标志是何含义？', ['多股铁路与道路相交','有人看守铁路道口','无人看守铁路道口','注意长时鸣喇叭'], 2, '秒懂技巧：铁路口有人栅栏无人烟，表示火车冒烟是无人看守的铁路道口'),
  q(38, 'MC', '这个标志是何含义？', ['高速公路公用电话','高速公路报警电话','高速公路紧急电话','高速公路救援电话'], 3, '秒懂技巧：图中标志有救援，选救援'),
  q(46, 'MC', '路右侧车行道边缘白色虚线是什么含义？', ['车辆可临时越线行驶','车辆禁止越线行驶','应急车道分界线','人行横道分界线'], 0, '秒懂技巧：虚线表示可跨越'),
  q(49, 'MC', '图中圈内白色虚线是什么标线？', ['小型车转弯线','车道连接线','非机动车引导线','路口导向线'], 3, '秒懂技巧：路口线都是导向线，有导向优先选'),
  q(64, 'MC', '这一组交通警察手势是什么信号？', ['直行信号','转弯信号','停止信号','靠边停车信号'], 0, '秒懂技巧：交警的手张开伸直，选直行'),
  q(66, 'MC', '这一组交通警察手势是什么信号？', ['左转弯信号','停止信号','右转弯信号','靠边停车信号'], 1, '秒懂技巧：交警的手高举过头，选不准通行/停止'),
  q(71, 'MC', '雨天对安全行车的主要影响是什么？', ['电器设备易受潮短路','路面湿滑，视线受阻','发动机易熄火','行驶阻力增大'], 1, '关键字答题：看到雨天，选湿滑'),
  q(83, 'MC', '夜间驾驶车辆遇自行车对向驶来时，应怎样做？', ['连续变换远、近光灯','不断鸣喇叭','使用远光灯','使用近光灯，减速或停车避让'], 3, '秒懂技巧：任何天气，前方有车/人，就只能开近光灯'),
  q(116, 'MC', '这个仪表是何含义？', ['发动机转速表','行驶速度表','区间里程表','百公里油耗表'], 0, '秒懂技巧：看到仪表盘数字不超过10选发动机转速表'),
  q(123, 'MC', '发动机起动后仪表板上（如图所示）亮表示什么？', ['发动机机油压力过高','发动机主油道堵塞','发动机机油压力过低','发动机曲轴箱漏气'], 2, '秒懂技巧：图中有滴选过低'),
  q(139, 'MC', '这是什么操纵装置？', ['节气门操纵杆','驻车制动器操纵杆','变速器操纵杆','离合器操纵杆'], 2, '秒懂技巧：图中标志圆圈上面有挡位的，选变速器操纵杆'),
];

export const DRIVING_THEORY_USER_PDF_PILOT_ITEMS = deepFreeze(RAW.map((item) => ({
  sourcePage: item.page,
  requestedPage: item.page,
  actualPdfPage: item.page,
  sourceQuestionIdentity: `pdf:${DRIVING_THEORY_USER_PDF_SHA256}:page:${item.page}`,
  sourceQuestionType: item.sourceType,
  canonicalContentType: 'multiple_choice',
  sourceAnswer: String.fromCharCode(65 + item.answerIndex),
  canonicalCorrectAnswer: item.options[item.answerIndex],
  hasQuestionImage: Boolean(MEDIA[item.page]),
  questionImageAsset: MEDIA[item.page] ?? null,
  sourceClassification: 'USER_PROVIDED',
  sourceOriginClassification: 'THIRD_PARTY_SOURCE_UNVERIFIED',
  sourceSha256: DRIVING_THEORY_USER_PDF_SHA256,
  sourcePageHash: PAGE_HASHES[item.page],
  extractionStatus: 'PASS',
  explanationClassification: 'ORIGINAL_USER_PROVIDED_SOURCE_CONTENT',
  content: createMultipleChoiceContent({
    contentId: `driving-user-pdf:${String(item.page).padStart(3, '0')}`,
    contentType: 'multiple_choice', question: item.question, answer: item.options[item.answerIndex], options: item.options,
    correctAnswer: item.options[item.answerIndex], explanation: item.explanation,
    tags: ['user-provided','third-party-source-unverified','private-local-pilot', item.sourceType === 'TRUE_FALSE' ? 'source-true-false' : 'source-mc', MEDIA[item.page] ? 'required-question-media' : 'text-only'],
    sourceRef: `${DRIVING_THEORY_USER_PDF_SOURCE_ID}:page:${item.page}`,
    createdAt: DRIVING_THEORY_USER_PDF_TIMESTAMP, updatedAt: DRIVING_THEORY_USER_PDF_TIMESTAMP,
  }),
})));

export const DRIVING_THEORY_USER_PDF_PILOT_CONTENTS = deepFreeze(DRIVING_THEORY_USER_PDF_PILOT_ITEMS.map((item) => item.content));
export const DRIVING_THEORY_USER_PDF_COLLECTION = createStudyCollection({
  collectionId: DRIVING_THEORY_USER_PDF_COLLECTION_ID,
  type: StudyCollectionType.QUESTION_BANK,
  title: '科目一 · 用户资料 Pilot',
  description: '用户提供的第三方来源未验证资料，仅限本地私有学习；非官方内容，禁止随 NEXA 打包或再分发。',
  source: DRIVING_THEORY_USER_PDF_SOURCE_ID,
  createdAt: DRIVING_THEORY_USER_PDF_TIMESTAMP,
  updatedAt: DRIVING_THEORY_USER_PDF_TIMESTAMP,
});
export const DRIVING_THEORY_USER_PDF_PILOT_MANIFEST = createStudyContentPackageManifest({
  packageId: 'driving-theory-user-pdf-pilot-v0-1', packageVersion: '0.1', collectionId: DRIVING_THEORY_USER_PDF_COLLECTION_ID,
  contentType: 'multiple_choice', itemCount: DRIVING_THEORY_USER_PDF_PILOT_CONTENTS.length,
  contentDigest: calculateStudyContentDigest(DRIVING_THEORY_USER_PDF_PILOT_CONTENTS),
  provenance: {
    sourceId: DRIVING_THEORY_USER_PDF_SOURCE_ID, classification: GenericStudySourceClassification.USER_PROVIDED,
    title: '科目一精简500题＋新规题-先看我.pdf', official: false, publicExamAuthority: null, originUrl: null, licenseId: null,
    evidenceRefs: [`sha256:${DRIVING_THEORY_USER_PDF_SHA256}`, 'staging:driving-theory-user-source/source-manifest.json'],
    acquiredAt: DRIVING_THEORY_USER_PDF_TIMESTAMP,
    permissions: { localStorage: true, modification: true, redistribution: false },
    notes: 'PRIVATE LOCAL SOURCE INPUT; THIRD_PARTY_SOURCE_UNVERIFIED; REDISTRIBUTION_STATUS=NOT_ESTABLISHED; NEXA_BUNDLING_ALLOWED=false',
  },
  createdAt: DRIVING_THEORY_USER_PDF_TIMESTAMP,
});
export const DRIVING_THEORY_USER_PDF_PILOT_PACKAGE_INPUT = JSON.stringify({ schemaVersion:'0.1', contents:DRIVING_THEORY_USER_PDF_PILOT_CONTENTS });

export function getDrivingTheoryPilotItem(contentId) {
  return DRIVING_THEORY_USER_PDF_PILOT_ITEMS.find((item) => item.content.contentId === contentId) ?? null;
}

function q(page, sourceType, question, options, answerIndex, explanation) { return { page, sourceType, question, options, answerIndex, explanation }; }
function media(page, [x,y,width,height], sha256) {
  return deepFreeze({
    assetId:`driving-user-pdf-page-${String(page).padStart(3,'0')}-question`,
    localAssetRef:`/api/private-media/driving-user-pdf/page-${String(page).padStart(3,'0')}-question.jpg`,
    alt:`用户提供科目一资料第${page}页题图`, sourcePdfSha256:DRIVING_THEORY_USER_PDF_SHA256, sourcePage:page,
    cropRegion:{x,y,width,height}, derivedAssetSha256:sha256, mimeType:'image/jpeg', width, height,
    derivationMethod:'LOCAL_PIXEL_CROP_FROM_DECRYPTED_DCT_PAGE; NO_AI; NO_WATERMARK_REMOVAL; NO_COLOR_TRANSFORM',
  });
}
