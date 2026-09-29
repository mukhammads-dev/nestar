import { BoardArticleService } from './../board-article/board-article.service';
import { PropertyService } from './../property/property.service';
import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, ObjectId } from 'mongoose';
import { MemberService } from '../member/member.service';
import { CommentInput, CommentsInquiry } from '../../libs/dto/comment/comment.input';
import { Direction, Message } from '../../libs/enums/common.enum';
import { CommentGroup, CommentStatus } from '../../libs/enums/comment.enum';
import { Comments, Comment } from '../../libs/dto/comment/comment';
import { CommentUpdate } from '../../libs/dto/comment/comment.update';
import { T } from '../../libs/types/common';
import { lookupMember } from '../../libs/config';

@Injectable()
export class CommentService {
    constructor(
        @InjectModel('Comment') private readonly commentModel: Model<Comment>,
        private memberService: MemberService,
        private propertyService: PropertyService,
        private readonly boardArticleService: BoardArticleService,
    ) { }

    public async createComment(memberId: ObjectId, input: CommentInput): Promise<Comment> {
        input.memberId = memberId;
        let result: Comment | null = null;

        try {
            result = await this.commentModel.create(input);
        } catch (err) {
            console.log('Error, Servise.model:', err.message);
            throw new BadRequestException(Message.CREATE_FAILED);
        }
        // izoh qaysi turga yozilgan bo'lsa, o'shaning hisoblagichi +1
        await this.commentStatsEditor(input.commentGroup, input.commentRefId, 1);

        if (!result) throw new InternalServerErrorException(Message.CREATE_FAILED);
        return result;
    }

    public async updateComment(memberId: ObjectId, input: CommentUpdate): Promise<Comment> {
        const { _id, commentStatus } = input;
        const result = await this.commentModel.findOneAndUpdate(
            {
                _id: _id,  // qaysi izoh
                memberId: memberId,    // izohni kim yozgan
                commentStatus: CommentStatus.ACTIVE,
            },
            input,
            {
                new: true,
            },
        ).exec();
        if (!result) throw new InternalServerErrorException(Message.UPDATE_FAILED);

        // izoh o'chirilsa — tegishli hujjatning izoh hisoblagichi -1 bo'lishi kerak
        if (commentStatus === CommentStatus.DELETE) {
            await this.commentStatsEditor(result.commentGroup, result.commentRefId, -1);
        }

        return result;
    }

    // createComment va updateComment uchun umumiy: qaysi turga tegishli bo'lsa,
    // o'sha service'ning hisoblagichini modifier qadar o'zgartiradi
    private async commentStatsEditor(
        commentGroup: CommentGroup,
        commentRefId: ObjectId,
        modifier: number,
    ): Promise<void> {
        switch (commentGroup) {
            case CommentGroup.PROPERTY:
                await this.propertyService.propertyStatsEditor({
                    _id: commentRefId,
                    targetKey: 'propertyComments',
                    modifier: modifier,
                });
                break;

            case CommentGroup.ARTICLE:
                await this.boardArticleService.boardArticleStatsEditor({
                    _id: commentRefId,
                    targetKey: 'articleComments',
                    modifier: modifier,
                });
                break;

            case CommentGroup.MEMBER:
                await this.memberService.memberStatsEditor({
                    _id: commentRefId,
                    targetKey: 'memberComments',
                    modifier: modifier,
                });
                break;
        }
    }

    public async getComments(memberId: ObjectId, input: CommentsInquiry): Promise<Comments> {
        const { commentRefId } = input.search;
        const match: T = { commentRefId: commentRefId, commentStatus: CommentStatus.ACTIVE };
        const sort: T = { [input?.sort ?? 'createdAt']: input?.direction ?? Direction.DESC };

        const result: Comments[] = await this.commentModel
            .aggregate([
                { $match: match },
                { $sort: sort },
                {
                    $facet: {
                        list: [
                            { $skip: (input.page - 1) * input.limit },
                            { $limit: input.limit },
                            lookupMember,
                            { $unwind: '$memberData' },
                        ],
                        //meliked
                        metaCounter: [{ $count: 'total' }],
                    },
                },
            ])
            .exec();

        if (!result.length) throw new InternalServerErrorException(Message.NO_DATA_FOUND);
        return result[0];
    }

    // comment juda muxum malumot emas shunga status delete qilmasdan birdan delete qildik
    public async removeCommentByAdmin(input: ObjectId): Promise<Comment> {
        const result = await this.commentModel.findByIdAndDelete(input).exec();
        if (!result) throw new InternalServerErrorException(Message.REMOVE_FAILED);

        // admin o'chirsa ham hisoblagich to'g'ri qolishi kerak
        if (result.commentStatus === CommentStatus.ACTIVE) {
            await this.commentStatsEditor(result.commentGroup, result.commentRefId, -1);
        }

        return result;
    }
}